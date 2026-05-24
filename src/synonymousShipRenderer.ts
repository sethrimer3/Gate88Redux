import { Camera } from './camera.js';
import { Colors, colorToCSS, type Color } from './colors.js';
import type { PlayerShip } from './ship.js';
import { clamp } from './math.js';

type FormationKind = 'idle' | 'building' | 'moving' | 'shooting' | 'boosting' | 'buildCircle';

interface SwarmParticle {
  x: number;
  y: number;
  tx: number;
  ty: number;
  seed: number;
  phase: number;
  shade: number;
  priority: number;
}

const PARTICLE_CAP = 50;
const BASE_FULL_COUNT = 40;
const UPGRADED_FULL_COUNT = 50;
const MIN_VISIBLE_COUNT = 20;
const SMOOTHING = 13;
const HERO_VISUAL_SCALE = 0.6;

export class SynonymousShipRenderer {
  private particles: SwarmParticle[] = [];
  private initialized = false;

  constructor() {
    for (let i = 0; i < PARTICLE_CAP; i++) {
      const seed = seeded01(i + 1, 93217);
      const angle = seed * Math.PI * 2;
      const radius = 4 + seeded01(i + 1, 11391) * 12;
      this.particles.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        tx: 0,
        ty: 0,
        seed,
        phase: seeded01(i + 1, 71821) * Math.PI * 2,
        shade: 0.82 + seeded01(i + 1, 44123) * 0.32,
        priority: seeded01(i + 1, 27119),
      });
    }
    this.particles.sort((a, b) => a.priority - b.priority);
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, ship: PlayerShip, buildingActive: boolean): void {
    const screen = camera.worldToScreen(ship.position);
    const scale = camera.zoom;
    const maxCircles = ship.synonymousVitalityUnlocked ? UPGRADED_FULL_COUNT : BASE_FULL_COUNT;
    const healthFraction = clamp(ship.health / Math.max(1, ship.maxHealth), 0, 1);
    const visible = Math.round(MIN_VISIBLE_COUNT + (maxCircles - MIN_VISIBLE_COUNT) * healthFraction);
    const formation = this.formationFor(ship, buildingActive);
    const dt = 1 / 60;
    const lerp = 1 - Math.exp(-SMOOTHING * dt);

    for (let i = 0; i < PARTICLE_CAP; i++) {
      const p = this.particles[i];
      this.targetFor(p, i, visible, formation, ship, p);
      if (!this.initialized) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += (p.tx - p.x) * lerp;
        p.y += (p.ty - p.y) * lerp;
      }
    }
    this.initialized = true;

    const base = cloneColor(Colors.mainguy);
    const radius = Math.max(1.1, 2.35 * HERO_VISUAL_SCALE * scale);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(ship.angle);

    if (formation === 'shooting' && ship.synonymousMuzzleFlash > 0) {
      const alpha = Math.min(0.3, ship.synonymousMuzzleFlash / 0.22 * 0.3);
      const dark = cloneColor(base, 0.38);
      ctx.fillStyle = colorToCSS(dark, alpha);
      ctx.beginPath();
      ctx.moveTo(18 * HERO_VISUAL_SCALE * scale, -5 * HERO_VISUAL_SCALE * scale);
      ctx.lineTo(62 * HERO_VISUAL_SCALE * scale, -16 * HERO_VISUAL_SCALE * scale);
      ctx.lineTo(62 * HERO_VISUAL_SCALE * scale, 16 * HERO_VISUAL_SCALE * scale);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < visible; i++) {
      const p = this.particles[i];
      const x = p.x * scale;
      const y = p.y * scale;
      const shaded = cloneColor(base, p.shade);
      ctx.fillStyle = colorToCSS(shaded, 0.78 + healthFraction * 0.16);
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.78 + p.seed * 0.38), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorToCSS(Colors.particles_switch, 0.18);
      ctx.lineWidth = Math.max(0.6, 0.8 * scale);
      ctx.stroke();
    }

    if (ship.spawnInvincibilityTimer > 0) {
      const fraction = clamp(ship.spawnInvincibilityTimer / 5, 0, 1);
      ctx.strokeStyle = colorToCSS(Colors.particles_spark, 0.45 * fraction);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 32 * HERO_VISUAL_SCALE * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private formationFor(ship: PlayerShip, buildingActive: boolean): FormationKind {
    if (ship.isBoosting) return 'boosting';
    if (ship.synonymousMuzzleFlash > 0 || ship.primaryFireTimer > 0.01) return 'shooting';
    if (buildingActive && ship.isThrusting && !ship.isBoosting) return 'buildCircle';
    if (ship.velocity.length() > 12 || ship.isThrusting) return 'moving';
    if (buildingActive) return 'building';
    return 'idle';
  }

  private targetFor(_src: SwarmParticle, i: number, n: number, kind: FormationKind, ship: PlayerShip, out: SwarmParticle): void {
    const t = n <= 1 ? 0 : i / (n - 1);
    const time = ship.drawTime;
    if (kind === 'idle') {
      const edge = Math.floor(t * 5);
      const localT = t * 5 - edge;
      const a0 = time * 0.28 + edge * Math.PI * 2 / 5 - Math.PI / 2;
      const a1 = time * 0.28 + (edge + 1) * Math.PI * 2 / 5 - Math.PI / 2;
      const r = 18 * HERO_VISUAL_SCALE;
      out.tx = Math.cos(a0) * r * (1 - localT) + Math.cos(a1) * r * localT;
      out.ty = Math.sin(a0) * r * (1 - localT) + Math.sin(a1) * r * localT;
      return;
    }
    if (kind === 'building') {
      const angle = t * Math.PI * 2 + out.seed * 0.45;
      const ring = i % 3 === 0 ? 0.45 : 1;
      const pulse = Math.sin(time * 2.2 + out.phase) * 4.5 * HERO_VISUAL_SCALE;
      const r = (8 + ring * 13) * HERO_VISUAL_SCALE + pulse;
      out.tx = Math.cos(angle) * r;
      out.ty = Math.sin(angle) * r;
      return;
    }
    if (kind === 'buildCircle') {
      const angle = t * Math.PI * 2 + time * 0.22;
      const pulse = Math.sin(time * 2.4 + out.phase) * 1.6 * HERO_VISUAL_SCALE;
      const r = 20 * HERO_VISUAL_SCALE + pulse;
      out.tx = Math.cos(angle) * r;
      out.ty = Math.sin(angle) * r;
      return;
    }
    const noseOpen = kind === 'shooting' ? 4.5 * clamp(ship.synonymousMuzzleFlash / 0.22, 0, 1) : 0;
    const wobble = Math.sin(time * 5.2 + out.phase) * 0.7 * HERO_VISUAL_SCALE;
    if (kind === 'boosting') {
      const perimeter = t * 4;
      const a = { x: 34, y: 0 };
      const b = { x: -22, y: -9 };
      const c = { x: -10, y: 0 };
      const d = { x: -22, y: 9 };
      const segment = Math.floor(Math.min(3, perimeter));
      const u = perimeter - segment;
      const from = segment === 0 ? a : segment === 1 ? b : segment === 2 ? c : d;
      const to = segment === 0 ? b : segment === 1 ? c : segment === 2 ? d : a;
      out.tx = (from.x * (1 - u) + to.x * u) * HERO_VISUAL_SCALE;
      out.ty = (from.y * (1 - u) + to.y * u) * HERO_VISUAL_SCALE + wobble;
      return;
    }
    const perimeter = t * 3;
    const a = { x: (24 - noseOpen) * HERO_VISUAL_SCALE, y: 0 };
    const b = { x: -20 * HERO_VISUAL_SCALE, y: -17 * HERO_VISUAL_SCALE };
    const c = { x: -20 * HERO_VISUAL_SCALE, y: 17 * HERO_VISUAL_SCALE };
    if (perimeter < 1) {
      out.tx = a.x * (1 - perimeter) + b.x * perimeter;
      out.ty = a.y * (1 - perimeter) + b.y * perimeter + wobble;
    } else if (perimeter < 2) {
      const u = perimeter - 1;
      out.tx = b.x * (1 - u) + c.x * u;
      out.ty = b.y * (1 - u) + c.y * u + wobble;
    } else {
      const u = perimeter - 2;
      out.tx = c.x * (1 - u) + a.x * u;
      out.ty = c.y * (1 - u) + a.y * u + wobble;
    }
  }
}

function seeded01(index: number, salt: number): number {
  let h = Math.imul(index | 0, 374761393) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function cloneColor(color: Color, intensity: number = color.intensity): Color {
  return { r: color.r, g: color.g, b: color.b, intensity };
}
