/**
 * Distant Suns / Solar Backdrop for Gate88.
 *
 * Renders one enormous warm sun far behind the battlefield, bathing the
 * scene in golden-orange solar light — molten gold core, amber halo,
 * deep red outer glow, soft violet-pink fringe where it fades into the nebula.
 *
 * Draw order: after the deep-space background fill, before the baked nebula.
 *
 * Performance design:
 * - The main radial glow is baked once into an offscreen canvas sized to the
 *   screen.  It is rebuilt only on resize (same pattern as Nebula.screenWisps).
 * - Volumetric light rays are thin tapered triangles — no blur, no getImageData.
 * - Atomic orbit lines are bright partial ellipses with animated length/alpha.
 * - Glints are tiny cross / dot primitives with a per-instance alpha ramp.
 * - Quality-scaled through four new VisualQualityPreset fields:
 *     Low    → glow only, no rays, no corona, no glints.
 *     Medium → glow + 5 subtle rays.
 *     High   → glow + 8 rays + atomic orbit lines + rare warm glints.
 */

import { Camera } from './camera.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import type { VisualQualityPreset } from './visualquality.js';

// ---------------------------------------------------------------------------
// Sun placement (one randomized screen-fraction anchor per game load)
// ---------------------------------------------------------------------------

interface SunPlacement {
  /** Horizontal screen fraction for the sun center (0 = left, 1 = right). */
  cx: number;
  /** Vertical screen fraction for the sun center (0 = top, 1 = bottom). */
  cy: number;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createSunPlacement(): SunPlacement {
  const side = Math.floor(Math.random() * 4);
  switch (side) {
    case 0:
      return { cx: randomRange(0.14, 0.86), cy: randomRange(0.08, 0.24) };
    case 1:
      return { cx: randomRange(0.14, 0.86), cy: randomRange(0.76, 0.92) };
    case 2:
      return { cx: randomRange(0.08, 0.24), cy: randomRange(0.16, 0.84) };
    default:
      return { cx: randomRange(0.76, 0.92), cy: randomRange(0.16, 0.84) };
  }
}

const SUN_PLACEMENT = createSunPlacement();

/**
 * Parallax shift per world-unit of camera displacement.
 * Increased for a stronger sense of depth when the camera pans.
 */
const PARALLAX_X = 0.036;
const PARALLAX_Y = 0.036;

export function getDistantSunScreenPosition(camera: Camera, screenW: number, screenH: number): { x: number; y: number } {
  const dx = (camera.position.x - WORLD_WIDTH  * 0.5) * PARALLAX_X;
  const dy = (camera.position.y - WORLD_HEIGHT * 0.5) * PARALLAX_Y;
  return {
    x: screenW * SUN_PLACEMENT.cx - dx,
    y: screenH * SUN_PLACEMENT.cy - dy,
  };
}

// ---------------------------------------------------------------------------
// Ray counts per quality tier
// ---------------------------------------------------------------------------

const RAY_COUNT_MEDIUM = 6;
const RAY_COUNT_HIGH   = 10;

// ---------------------------------------------------------------------------
// Glint pool
// ---------------------------------------------------------------------------

interface Glint {
  /** Screen-fraction X center. */
  x: number;
  /** Screen-fraction Y center. */
  y: number;
  life: number;
  maxLife: number;
  /** Half-size (px) for the cross arms. */
  size: number;
}

// ---------------------------------------------------------------------------
// DistantSuns
// ---------------------------------------------------------------------------

export class DistantSuns {
  /** Pre-baked radial glow canvas (screen-sized, rebuilt on resize). */
  private glowCanvas: HTMLCanvasElement;
  private screenW = 0;
  private screenH = 0;

  /**
   * Offscreen light buffer for volumetric rays — rendered at half resolution,
   * then composited back with a blur filter to eliminate hard polygon edges and
   * overlap seam artifacts.  Cached and resized only when the screen changes.
   */
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private lightW = 0;
  private lightH = 0;

  /** Accumulated time for shimmer / ray / corona animation. */
  private time = 0;

  // Quality flags (set by configure())
  private enabled   = true;
  private raysEnabled   = false;
  private coronaEnabled = false;
  private glintsEnabled = false;

  // Glint pool
  private glints: Glint[] = [];
  private glintCooldown = 1.5;

  constructor() {
    this.glowCanvas = document.createElement('canvas');
    this.glowCanvas.width  = 1;
    this.glowCanvas.height = 1;
    this.lightCanvas = document.createElement('canvas');
    this.lightCanvas.width  = 1;
    this.lightCanvas.height = 1;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Apply a visual quality preset.  Resets the bake-dirty flag so the glow
   * canvas is rebuilt at the next draw call.
   */
  configure(preset: VisualQualityPreset): void {
    this.enabled       = preset.distantSunsEnabled;
    this.raysEnabled   = preset.distantSunsRays;
    this.coronaEnabled = preset.distantSunsCorona;
    this.glintsEnabled = preset.distantSunsGlints;
    // Force re-bake at next draw call.
    this.screenW = 0;
    this.screenH = 0;
  }

  // -------------------------------------------------------------------------
  // Fixed-tick update (driven from game.ts at DT = 1/60 s)
  // -------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;

    if (!this.enabled || !this.glintsEnabled) return;

    // Age existing glints.
    for (const g of this.glints) {
      if (g.life > 0) g.life -= dt;
    }

    // Spawn new glint on cooldown.
    this.glintCooldown -= dt;
    if (this.glintCooldown <= 0) {
      this.spawnGlint();
      this.glintCooldown = 2.0 + Math.random() * 3.5;
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Draw the distant suns layer.
   * Must be called after the solid background fill and before nebula.draw().
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    if (!this.enabled) return;

    // Rebuild baked glow when screen changes.
    if (screenW !== this.screenW || screenH !== this.screenH) {
      this.screenW = screenW;
      this.screenH = screenH;
      this.bakeSunGlow();
    }

    // Resize half-resolution light buffer when screen changes.
    const lw = Math.max(1, Math.round(screenW / 2));
    const lh = Math.max(1, Math.round(screenH / 2));
    if (lw !== this.lightW || lh !== this.lightH) {
      this.lightW = lw;
      this.lightH = lh;
      this.lightCanvas.width  = lw;
      this.lightCanvas.height = lh;
      this.lightCtx = this.lightCanvas.getContext('2d');
    }

    // Tiny parallax offset (sun barely moves with the camera — deep background).
    const dx = (camera.position.x - WORLD_WIDTH  * 0.5) * PARALLAX_X;
    const dy = (camera.position.y - WORLD_HEIGHT * 0.5) * PARALLAX_Y;

    // Effective screen-space sun center, shifted by parallax.
    const cx = screenW * SUN_PLACEMENT.cx - dx;
    const cy = screenH * SUN_PLACEMENT.cy - dy;

    // 1 — Baked radial glow (all quality levels).
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this.glowCanvas, 0, 0, screenW, screenH);
    ctx.restore();

    // 2 — Warm directional screen fill (all quality levels).
    this.drawScreenWarmth(ctx, cx, cy, screenW, screenH);

    // 3 — Volumetric light rays (medium / high).
    // Drawn into a half-resolution offscreen buffer then composited back with
    // a blur filter — this eliminates hard polygon edges and overlap seams.
    if (this.raysEnabled && this.lightCtx) {
      const count = this.coronaEnabled ? RAY_COUNT_HIGH : RAY_COUNT_MEDIUM;
      const lc = this.lightCtx;
      lc.clearRect(0, 0, this.lightW, this.lightH);
      // Scale sun position to half-res buffer coordinates.
      this.drawRays(lc, cx * 0.5, cy * 0.5, this.lightW, this.lightH, count);
      // Composite with a blur to soften beam edges into atmospheric light shafts.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = 'blur(8px)';
      ctx.drawImage(this.lightCanvas, 0, 0, screenW, screenH);
      ctx.restore();
    }

    // 4 - Back half of atomic orbit lines (high only).
    if (this.coronaEnabled) {
      this.drawAtomicOrbitLayer(ctx, cx, cy, screenW, screenH, false);
    }

    // 5 - Rare warm glints (high only).
    if (this.glintsEnabled) {
      this.drawGlints(ctx, screenW, screenH);
    }

    // 6 - Front half of atomic orbit lines (high only).
    if (this.coronaEnabled) {
      this.drawAtomicOrbitLayer(ctx, cx, cy, screenW, screenH, true);
    }
  }

  // -------------------------------------------------------------------------
  // Baking
  // -------------------------------------------------------------------------

  /**
   * Render the sun's radial glow gradient into the offscreen canvas.
   * The canvas is screen-sized; the gradient is anchored at the randomized sun
   * position and reaches far enough to spill warmth across the whole viewport.
   */
  private bakeSunGlow(): void {
    const w = this.screenW;
    const h = this.screenH;
    this.glowCanvas.width  = w;
    this.glowCanvas.height = h;

    const ctx = this.glowCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const cx = w * SUN_PLACEMENT.cx;
    const cy = h * SUN_PLACEMENT.cy;
    // Radius generous enough to bathe the whole screen in warmth.
    const r  = Math.hypot(w, h) * 1.18;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.000, 'rgba(255,255,225,0.94)');  // near-white hot core
    grad.addColorStop(0.012, 'rgba(255,235,145,0.86)');  // molten gold
    grad.addColorStop(0.032, 'rgba(255,192,70,0.70)');   // rich amber
    grad.addColorStop(0.068, 'rgba(242,132,34,0.48)');   // burnt orange
    grad.addColorStop(0.135, 'rgba(200,72,18,0.28)');    // deep red
    grad.addColorStop(0.270, 'rgba(148,32,48,0.14)');    // rose-red
    grad.addColorStop(0.460, 'rgba(88,14,88,0.07)');     // soft violet
    grad.addColorStop(0.720, 'rgba(42,7,62,0.03)');      // deep purple fade
    grad.addColorStop(1.000, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // -------------------------------------------------------------------------
  // Screen-space directional warmth (all quality levels)
  // -------------------------------------------------------------------------

  /**
   * Draw a very faint warm radial overlay extending from the sun across the
   * whole screen.  This subtly tints everything in the sun's direction without
   * washing out gameplay objects.
   */
  private drawScreenWarmth(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const r = Math.hypot(w, h) * 0.98;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.00, 'rgba(255,182,62,0.065)');
    grad.addColorStop(0.30, 'rgba(220,122,40,0.042)');
    grad.addColorStop(0.65, 'rgba(160,58,18,0.022)');
    grad.addColorStop(1.00, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Volumetric light rays (medium / high)
  // -------------------------------------------------------------------------

  /**
   * Draw soft feathered light rays emanating from the sun center.
   * Each ray is rendered as three layered semi-transparent passes of decreasing
   * width, producing a natural alpha-falloff from the ray axis toward the edges.
   * This creates a cinematic "shaft of light" appearance without any blur calls.
   */
  private drawRays(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    count: number,
  ): void {
    const len = Math.hypot(w, h) * 0.82;
    const rot = this.time * 0.007;   // very slow global rotation

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < count; i++) {
      // Slightly irregular spacing with a slow wobble per ray.
      const baseAngle  = (i / count) * Math.PI * 2 + rot;
      const wobble     = Math.sin(this.time * 0.22 + i * 1.13) * 0.04;
      const angle      = baseAngle + wobble;

      const tipX = cx + Math.cos(angle) * len;
      const tipY = cy + Math.sin(angle) * len;

      // Perpendicular unit vector for controlling base width.
      const px = -Math.sin(angle);
      const py =  Math.cos(angle);

      // Per-ray flicker (subtle).  Alpha reduced slightly — the blur on composite
      // spreads each beam wider, so lower per-pass alpha keeps overall brightness
      // balanced while reducing visible overlap seams.
      const flicker = 0.036 + 0.016 * Math.sin(this.time * 0.72 + i * 0.88);

      // Build a gradient that fades from bright at base to transparent at tip.
      const makeGrad = (alpha: number): CanvasGradient => {
        const g = ctx.createLinearGradient(cx, cy, tipX, tipY);
        g.addColorStop(0.00, `rgba(255,215,95,${(alpha).toFixed(3)})`);
        g.addColorStop(0.18, `rgba(255,168,60,${(alpha * 0.72).toFixed(3)})`);
        g.addColorStop(0.50, `rgba(240,108,32,${(alpha * 0.30).toFixed(3)})`);
        g.addColorStop(0.80, `rgba(200,70,18,${(alpha * 0.08).toFixed(3)})`);
        g.addColorStop(1.00, 'rgba(0,0,0,0)');
        return g;
      };

      const drawPass = (halfWidthMult: number, alphaScale: number): void => {
        const hw = len * 0.022 * halfWidthMult;
        ctx.fillStyle = makeGrad(flicker * alphaScale);
        ctx.beginPath();
        ctx.moveTo(cx + px * hw, cy + py * hw);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(cx - px * hw, cy - py * hw);
        ctx.closePath();
        ctx.fill();
      };

      // Five passes with quadratic-style falloff from core to edges.
      // Combined with the 8 px blur on composite, these produce soft atmospheric
      // light shafts rather than hard transparent polygons.
      drawPass(6.0, 0.15);  // outermost fringe — very wide, nearly transparent
      drawPass(4.0, 0.28);  // outer halo
      drawPass(2.5, 0.46);  // mid halo
      drawPass(1.6, 0.68);  // inner halo
      drawPass(1.0, 1.00);  // core spine — narrowest, brightest
    }

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Atomic orbit lines (high only)
  // -------------------------------------------------------------------------

  /**
   * Draw bright, partial, slowly shifting orbit lines around the sun.  The
   * front/back split makes some strokes appear to pass behind the solar core.
   */
  private drawAtomicOrbitLayer(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    front: boolean,
  ): void {
    const baseR = Math.max(w, h) * 0.052;
    const orbitCount = 7;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let orbit = 0; orbit < orbitCount; orbit++) {
      const seed = orbit * 1.71;
      const phase = this.time * (0.15 + orbit * 0.018) + seed;
      const inFront = Math.sin(phase + orbit * 0.63) >= 0;
      if (inFront !== front) continue;

      const lengthPulse = 0.58 + 0.28 * Math.sin(this.time * (0.28 + orbit * 0.03) + seed);
      const arcLength = Math.PI * Math.max(0.32, lengthPulse);
      const startA = phase + Math.sin(this.time * 0.21 + seed) * 0.65;
      const endA = startA + arcLength;
      const r = baseR * (0.82 + orbit * 0.16) * (1 + 0.055 * Math.sin(this.time * 0.34 + seed));
      const yScale = 0.24 + (orbit % 4) * 0.105;
      const tilt = orbit * Math.PI / orbitCount + this.time * (0.022 - orbit * 0.0018);
      const alphaPulse = 0.50 + 0.50 * Math.sin(this.time * (0.42 + orbit * 0.05) + seed * 0.7);
      const alpha = (front ? 0.46 : 0.22) * alphaPulse;
      if (alpha < 0.035) continue;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.strokeStyle = front
        ? `rgba(255,245,176,${alpha.toFixed(3)})`
        : `rgba(255,178,68,${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.8, Math.max(w, h) * (front ? 0.00125 : 0.00085));
      ctx.shadowColor = front ? 'rgba(255,236,146,0.52)' : 'rgba(255,135,34,0.30)';
      ctx.shadowBlur = front ? 10 : 6;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * yScale, 0, startA, endA);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Glint management (high only)
  // -------------------------------------------------------------------------

  private spawnGlint(): void {
    let slot = this.glints.find((g) => g.life <= 0);
    if (!slot && this.glints.length < 5) {
      slot = { x: 0, y: 0, life: 0, maxLife: 0, size: 0 };
      this.glints.push(slot);
    }
    if (!slot) return;

    // Scatter glints near the sun center (screen-fraction coords).
    const a   = Math.random() * Math.PI * 2;
    const d   = 0.03 + Math.random() * 0.10;
    slot.x       = SUN_PLACEMENT.cx + Math.cos(a) * d * 0.72;
    slot.y       = SUN_PLACEMENT.cy + Math.sin(a) * d * 0.44;
    slot.maxLife = 0.5 + Math.random() * 0.85;
    slot.life    = slot.maxLife;
    slot.size    = 2.5 + Math.random() * 5.5;
  }

  /**
   * Draw lens-flare-like warm glints — tiny cross / dot shapes that fade in
   * and out near the sun.
   */
  private drawGlints(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    if (this.glints.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (const g of this.glints) {
      if (g.life <= 0) continue;
      const t     = g.life / g.maxLife;
      const alpha = Math.sin(t * Math.PI) * 0.88;  // smooth fade in/out
      const gx    = g.x * w;
      const gy    = g.y * h;
      const r     = g.size * (0.38 + t * 0.62);

      // Four-point cross (diffraction spike feel).
      ctx.strokeStyle = `rgba(255,242,155,${alpha.toFixed(3)})`;
      ctx.lineWidth   = 0.7;
      ctx.beginPath();
      ctx.moveTo(gx, gy - r * 3.8);
      ctx.lineTo(gx, gy + r * 3.8);
      ctx.moveTo(gx - r * 3.8, gy);
      ctx.lineTo(gx + r * 3.8, gy);
      ctx.stroke();

      // Bright center dot.
      ctx.fillStyle = `rgba(255,255,215,${(alpha * 0.68).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(0.4, r * 0.52), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
