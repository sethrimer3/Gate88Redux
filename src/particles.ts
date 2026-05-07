/** Particle system for Gate88 */

import { Vec2, randomRange } from './math.js';
import { Camera } from './camera.js';
import { Team } from './entities.js';
import { Colors, colorToCSS, Color } from './colors.js';

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

// ---------------------------------------------------------------------------
// ParticleSystem
// ---------------------------------------------------------------------------

export class ParticleSystem {
  private pool: Particle[];
  private nextIndex: number = 0;

  constructor() {
    this.pool = Array.from({ length: POOL_SIZE }, createParticle);
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

  emitExhaust(pos: Vec2, angle: number, team: Team): void {
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
    const backAngle = angle + Math.PI;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const spread = randomRange(-0.3, 0.3);
      const spd = randomRange(30, 80);
      p.vx = Math.cos(backAngle + spread) * spd;
      p.vy = Math.sin(backAngle + spread) * spd;
      p.color = color;
      p.alpha = 1;
      p.life = randomRange(0.2, 0.5);
      p.maxLife = p.life;
      p.size = randomRange(1, 2.5);
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
  emitSideExhaust(pos: Vec2, angle: number, sideSign: number, team: Team): void {
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
      const spread = randomRange(-0.3, 0.3);
      const spd = randomRange(25, 60);
      p.vx = Math.cos(exhaustAngle + spread) * spd;
      p.vy = Math.sin(exhaustAngle + spread) * spd;
      p.color = color;
      p.alpha = 0.9;
      p.life = randomRange(0.15, 0.35);
      p.maxLife = p.life;
      p.size = randomRange(0.8, 2.0);
      p.additive = false;
    }
  }

  emitExplosion(pos: Vec2, size: number): void {
    {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      p.vx = 0;
      p.vy = 0;
      p.color = Colors.particles_explosion3;
      p.alpha = 1;
      p.life = 0.08;
      p.maxLife = p.life;
      p.size = Math.max(3, size * 0.55);
      p.additive = true;
    }

    // Primary fireball — large additive particles that bloom together.
    const primaryCount = Math.floor(18 + size * 2.5);
    const colors: Color[] = [
      Colors.particles_explosion1,
      Colors.particles_explosion2,
      Colors.alert2,
      Colors.particles_explosion3,
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
      p.color = colors[i % colors.length];
      p.alpha = 1;
      p.life = randomRange(0.35, 1.1);
      p.maxLife = p.life;
      p.size = randomRange(2.0, 4.5);
      p.additive = true;
    }

    // Secondary debris — small normal-blend particles that stay longer.
    const debrisCount = Math.floor(8 + size * 1.2);
    for (let i = 0; i < debrisCount; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x + randomRange(-size * 0.4, size * 0.4);
      p.y = pos.y + randomRange(-size * 0.4, size * 0.4);
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(10, 60) * (size / 20);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = Colors.particles_explosion2;
      p.alpha = 0.8;
      p.life = randomRange(0.5, 1.5);
      p.maxLife = p.life;
      p.size = randomRange(1.0, 2.5);
      p.additive = false;
    }

    // A small capped spark pass gives explosions brighter motion without
    // increasing POOL_SIZE or doing any per-pixel work.
    const sparkCount = Math.min(10, Math.floor(3 + size * 0.22));
    for (let i = 0; i < sparkCount; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(140, 260) * Math.max(0.65, size / 45);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = i % 3 === 0 ? Colors.alert2 : Colors.particles_explosion3;
      p.alpha = 1;
      p.life = randomRange(0.10, 0.24);
      p.maxLife = p.life;
      p.size = randomRange(0.9, 1.8);
      p.additive = true;
    }
  }

  emitSpark(pos: Vec2): void {
    const count = 5;
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
      p.alpha = 0.8;
      p.life = randomRange(0.3, 0.7);
      p.maxLife = p.life;
      p.size = randomRange(1, 2.5);
      p.additive = false;
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

    // Pass 1 — normal blend
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active || p.alpha <= 0 || p.additive) continue;

      const screen = camera.worldToScreen(new Vec2(p.x, p.y));
      const r = p.size * camera.zoom;

      ctx.fillStyle = colorToCSS(p.color, p.alpha);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(0.4, r), 0, Math.PI * 2);
      ctx.fill();
    }

    // Pass 2 — additive blend (hot glowing particles)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active || p.alpha <= 0 || !p.additive) continue;

      const screen = camera.worldToScreen(new Vec2(p.x, p.y));
      const r = p.size * camera.zoom;

      ctx.fillStyle = colorToCSS(p.color, p.alpha);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(0.4, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

