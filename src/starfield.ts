/**
 * Background starfield rendering for Gate88.
 *
 * Improvements over the original implementation:
 *  - 900 stars across three depth layers for a rich parallax effect.
 *  - Per-star twinkling via a phase-shifted sine oscillation.
 *  - Three colour archetypes: cool blue-white, neutral white, warm yellow-orange.
 *  - Rare "giant" bright stars (3× base size) scattered throughout.
 *  - Occasional shooting-star streaks that fire across the field.
 */

import { Vec2, randomRange } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS, Color } from './colors.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';

// ---------------------------------------------------------------------------
// Star data
// ---------------------------------------------------------------------------

/** 0 = cool blue-white, 1 = neutral white, 2 = warm yellow-orange */
type StarColorType = 0 | 1 | 2;

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
  /** Depth layer 0–1 where 0 is far (slow parallax) and 1 is near. */
  depth: number;
  /** Phase offset for the twinkling animation (radians). */
  twinklePhase: number;
  /** Twinkling oscillation frequency in radians-per-second. */
  twinkleRate: number;
  /** Colour archetype. */
  colorType: StarColorType;
  /** True for rare larger-than-normal giant stars. */
  isGiant: boolean;
}

// ---------------------------------------------------------------------------
// Shooting star data
// ---------------------------------------------------------------------------

interface ShootingStar {
  active: boolean;
  /** World-space start position. */
  x: number;
  y: number;
  /** World-space velocity (pixels/s). */
  vx: number;
  vy: number;
  /** Visible trail length in world units. */
  trailLen: number;
  /** Remaining lifetime (seconds). */
  life: number;
  maxLife: number;
  /** Countdown until the next shooting star spawns (seconds). */
  cooldown: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAR_COUNT     = 900;
const MAP_CENTER_X   = WORLD_WIDTH * 0.5;

/** Fraction of stars that are giant. */
const GIANT_FRACTION = 0.025;

/** CSS colour strings for each star archetype. */
const STAR_COLORS: Record<StarColorType, string> = {
  0: 'rgba(170,200,255,',   // cool blue-white
  1: 'rgba(230,230,240,',   // neutral white
  2: 'rgba(255,230,170,',   // warm yellow-orange
};

/** Weight distribution for colour archetypes (cumulative). */
const COLOR_WEIGHTS = [0.35, 0.80, 1.00]; // 35 % cool, 45 % white, 20 % warm

/** Shooting-star speed range (world units / second). */
const SHOOT_SPEED_MIN = 2000;
const SHOOT_SPEED_MAX = 4500;

/** Re-spawn interval range (seconds). */
const SHOOT_COOLDOWN_MIN = 8;
const SHOOT_COOLDOWN_MAX = 20;

// ---------------------------------------------------------------------------
// Starfield
// ---------------------------------------------------------------------------

export class Starfield {
  private stars: Star[] = [];
  private shootingStar: ShootingStar;
  private time: number = 0;

  constructor() {
    this.generate();
    this.shootingStar = {
      active: false,
      x: 0, y: 0, vx: 0, vy: 0,
      trailLen: 0,
      life: 0, maxLife: 0,
      cooldown: randomRange(SHOOT_COOLDOWN_MIN, SHOOT_COOLDOWN_MAX),
    };
  }

  // --------------------------------------------------------------------------
  // Generation
  // --------------------------------------------------------------------------

  private generate(): void {
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const roll = Math.random();
      let colorType: StarColorType;
      if (roll < COLOR_WEIGHTS[0])      colorType = 0;
      else if (roll < COLOR_WEIGHTS[1]) colorType = 1;
      else                              colorType = 2;

      const isGiant = Math.random() < GIANT_FRACTION;
      this.stars.push({
        x: randomRange(-WORLD_WIDTH * 0.5, WORLD_WIDTH * 1.5),
        y: randomRange(-WORLD_HEIGHT * 0.5, WORLD_HEIGHT * 1.5),
        brightness: isGiant ? randomRange(0.7, 1.0) : randomRange(0.15, 1.0),
        size: isGiant ? randomRange(2.5, 4.5) : randomRange(0.4, 1.8),
        depth: randomRange(0.05, 1.0),
        twinklePhase: randomRange(0, Math.PI * 2),
        twinkleRate: randomRange(1.0, 5.0),
        colorType,
        isGiant,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.updateShootingStar(dt);
  }

  private updateShootingStar(dt: number): void {
    const ss = this.shootingStar;
    if (ss.active) {
      ss.x    += ss.vx * dt;
      ss.y    += ss.vy * dt;
      ss.life -= dt;
      if (ss.life <= 0) {
        ss.active   = false;
        ss.cooldown = randomRange(SHOOT_COOLDOWN_MIN, SHOOT_COOLDOWN_MAX);
      }
    } else {
      ss.cooldown -= dt;
      if (ss.cooldown <= 0) {
        this.spawnShootingStar();
      }
    }
  }

  private spawnShootingStar(): void {
    const ss = this.shootingStar;
    // Spawn anywhere in an expanded world region.
    ss.x = randomRange(-WORLD_WIDTH * 0.2, WORLD_WIDTH * 1.2);
    ss.y = randomRange(-WORLD_HEIGHT * 0.2, WORLD_HEIGHT * 1.2);
    // Random direction, bias roughly leftward or downward for variety.
    const angle  = randomRange(0, Math.PI * 2);
    const speed  = randomRange(SHOOT_SPEED_MIN, SHOOT_SPEED_MAX);
    ss.vx        = Math.cos(angle) * speed;
    ss.vy        = Math.sin(angle) * speed;
    ss.trailLen  = randomRange(180, 400);
    ss.maxLife   = ss.trailLen / speed * 3;
    ss.life      = ss.maxLife;
    ss.active    = true;
  }

  // --------------------------------------------------------------------------
  // Drawing
  // --------------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, camera: Camera, screenW: number, screenH: number): void {
    this.drawStars(ctx, camera, screenW, screenH);
    this.drawShootingStar(ctx, camera, screenW, screenH);
  }

  private drawStars(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    const t = this.time;

    for (const star of this.stars) {
      // Parallax: deeper stars move slower relative to camera.
      const parallax = 0.2 + star.depth * 0.6;
      const sx =
        (star.x - camera.position.x * parallax) * camera.zoom + screenW * 0.5;
      const sy =
        (star.y - camera.position.y * parallax) * camera.zoom + screenH * 0.5;

      // Cull off-screen stars.
      if (sx < -6 || sx > screenW + 6 || sy < -6 || sy > screenH + 6) continue;

      // Twinkling: modulate brightness with a slow sine wave.
      const twinkle = 0.65 + 0.35 * Math.sin(t * star.twinkleRate + star.twinklePhase);
      const alpha   = star.brightness * twinkle * (0.45 + star.depth * 0.55);
      const r       = star.size * camera.zoom * (0.4 + star.depth * 0.6);

      const cssColor = STAR_COLORS[star.colorType];
      ctx.fillStyle = cssColor + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.4, r), 0, Math.PI * 2);
      ctx.fill();

      // Giant stars get a faint diffraction cross to make them pop.
      if (star.isGiant && r > 1.2) {
        const crossAlpha = alpha * 0.35;
        const crossLen   = r * 3.5;
        ctx.strokeStyle = cssColor + crossAlpha.toFixed(3) + ')';
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx - crossLen, sy);
        ctx.lineTo(sx + crossLen, sy);
        ctx.moveTo(sx, sy - crossLen);
        ctx.lineTo(sx, sy + crossLen);
        ctx.stroke();
      }
    }
  }

  private drawShootingStar(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    const ss = this.shootingStar;
    if (!ss.active) return;

    // Use depth = 0.6 so the shooting star has some parallax.
    const parallax = 0.56; // 0.2 + 0.6*0.6
    const headSx   = (ss.x - camera.position.x * parallax) * camera.zoom + screenW * 0.5;
    const headSy   = (ss.y - camera.position.y * parallax) * camera.zoom + screenH * 0.5;

    const angle    = Math.atan2(ss.vy, ss.vx);
    const trailPx  = ss.trailLen * camera.zoom * (ss.life / ss.maxLife);

    const tailSx   = headSx - Math.cos(angle) * trailPx;
    const tailSy   = headSy - Math.sin(angle) * trailPx;

    // Fade out as the shooting star dies.
    const fade     = Math.min(1, ss.life / (ss.maxLife * 0.25));

    const grad = ctx.createLinearGradient(headSx, headSy, tailSx, tailSy);
    grad.addColorStop(0.0, `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`);
    grad.addColorStop(0.3, `rgba(200,230,255,${(0.5 * fade).toFixed(3)})`);
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth   = Math.max(0.5, 1.2 * camera.zoom);
    ctx.beginPath();
    ctx.moveTo(headSx, headSy);
    ctx.lineTo(tailSx, tailSy);
    ctx.stroke();
  }
}

