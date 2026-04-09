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
}

// ---------------------------------------------------------------------------
// Object pool
// ---------------------------------------------------------------------------

const POOL_SIZE = 2048;

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
    }
  }

  emitExplosion(pos: Vec2, size: number): void {
    const count = Math.floor(12 + size * 2);
    const colors: Color[] = [
      Colors.particles_explosion1,
      Colors.particles_explosion2,
      Colors.particles_explosion3,
    ];
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x + randomRange(-size * 0.2, size * 0.2);
      p.y = pos.y + randomRange(-size * 0.2, size * 0.2);
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(20, 120) * (size / 20);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = colors[i % colors.length];
      p.alpha = 1;
      p.life = randomRange(0.3, 1.0);
      p.maxLife = p.life;
      p.size = randomRange(1.5, 3.5);
    }
  }

  emitSpark(pos: Vec2): void {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(40, 100);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = Colors.particles_spark;
      p.alpha = 1;
      p.life = randomRange(0.1, 0.3);
      p.maxLife = p.life;
      p.size = randomRange(1, 2);
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
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active || p.alpha <= 0) continue;

      const screen = camera.worldToScreen(new Vec2(p.x, p.y));
      const r = p.size * camera.zoom;

      ctx.fillStyle = colorToCSS(p.color, p.alpha);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
