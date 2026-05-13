/**
 * Asteroid Field for Gate88.
 *
 * Procedural multi-layer asteroid field with warm rim lighting and an
 * optional warm amber dust haze rendered from a baked offscreen canvas.
 *
 * Visual design:
 *  - Three parallax layers: far (small, dark), mid (medium, rim-lit),
 *    foreground (large, often near screen edges, strong rim light).
 *  - Each layer has a set of pre-generated sprite variants (irregular
 *    rocky polygons). Sprites are generated once from a seed and cached.
 *  - Rim lighting simulates the warm orange sun to the upper-right
 *    (matches SUN_CX=0.82, SUN_CY=-0.06 from suns.ts).
 *  - Dust haze is a low-resolution offscreen gradient, rebuilt only on resize.
 *
 * Performance:
 *  - Sprites baked once at startup (generate() in constructor).
 *  - Dust haze baked to half-resolution offscreen canvas, rebuilt on resize.
 *  - Per frame: screen-space transform + drawImage per visible asteroid only.
 *  - No per-frame polygon work, no getImageData, no full-screen blur.
 *
 * Draw order: after nebula/starfield, before crystal nebula.
 *
 * Quality integration (via VisualQualityPreset):
 *  - Low:    asteroidFieldLayers=0, dustHazeEnabled=false → nothing rendered.
 *  - Medium: asteroidFieldLayers=2, dustHazeEnabled=true  → far+mid + haze.
 *  - High:   asteroidFieldLayers=3, dustHazeEnabled=true  → all layers + haze.
 */

import { Camera } from './camera.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import type { VisualQualityPreset } from './visualquality.js';

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32 (same algorithm as crystalnebula.ts for consistency)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Developer-tunable configuration
// ---------------------------------------------------------------------------

/**
 * All tuning constants for the asteroid field in one place.
 * Adjust these to change the visual character without touching rendering logic.
 */
export const ASTEROID_FIELD_CONFIG = {
  /**
   * Base PRNG seed for deterministic sprite and placement generation.
   * Override by passing a seed to the AsteroidField constructor.
   */
  seed: 0x3a7f4c2b,

  /**
   * Screen-fraction position of the distant sun.
   * Must match SUN_CX / SUN_CY in suns.ts so rim lighting faces the right way.
   */
  sunScreenX: 0.82,
  sunScreenY: -0.06,

  /** Number of unique sprite shape variants generated per layer tier. */
  spriteVariants: 10,

  /**
   * Parallax factors per layer [x, y].
   * Smaller = deeper / slower. Should be well below the starfield (0.2–0.8).
   */
  parallaxX: [0.04, 0.08, 0.14] as [number, number, number],
  parallaxY: [0.04, 0.08, 0.14] as [number, number, number],

  /** Number of asteroid instances placed per layer. */
  counts: [28, 16, 7] as [number, number, number],

  /** World-unit radius range [min, max] per layer. */
  radiiRanges: [
    [20,  55],    // far:         small, barely visible rocks
    [55,  120],   // mid:         clearly visible, light rim
    [140, 320],   // foreground:  large masses, strong rim
  ] as [[number, number], [number, number], [number, number]],

  /** Sprite canvas size (pixels) per layer. */
  spriteSizes: [64, 96, 128] as [number, number, number],

  /**
   * Rim-light strength per layer (0–1).
   * Higher = more visible warm orange fringe facing the sun.
   */
  rimStrength: [0.11, 0.27, 0.44] as [number, number, number],

  /**
   * Body gradient color pairs [inner, outer] per layer tier (far/mid/foreground).
   * Inner color applies near the pseudo-lit center; outer applies toward the edges.
   */
  bodyColors: [
    ['#0e0605', '#1a0a07'] as [string, string],  // far:         near-black reddish
    ['#160906', '#24100c'] as [string, string],  // mid:         dark reddish-brown
    ['#221009', '#341609'] as [string, string],  // foreground:  slightly warmer dark
  ] as [[string, string], [string, string], [string, string]],

  /**
   * Opacity multiplier for the baked dust haze drawn with screen blend.
   * Keep ≤ 0.5 so gameplay objects remain clearly readable.
   */
  dustHazeOpacity: 0.32,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AsteroidInstance {
  /** World-space X centre. */
  wx: number;
  /** World-space Y centre. */
  wy: number;
  /** World-unit radius. */
  radius: number;
  /** Which cached sprite variant to use. */
  spriteIdx: number;
  /** Fixed rotation applied when drawing (radians). */
  rotation: number;
}

interface AsteroidLayer {
  parallaxX: number;
  parallaxY: number;
  instances: AsteroidInstance[];
  /** Pre-baked sprite canvases for this layer's tier. */
  sprites: HTMLCanvasElement[];
}

// ---------------------------------------------------------------------------
// AsteroidField
// ---------------------------------------------------------------------------

export class AsteroidField {
  /**
   * Generated layers: index 0 = far, 1 = mid, 2 = foreground.
   * Cached asteroid sprites are built once in generate() and reused every frame.
   */
  private layers: AsteroidLayer[] = [];

  /**
   * Warm dust haze baked at half-resolution.
   * Rebuilt only on screen resize (or quality change).
   */
  private dustCanvas: HTMLCanvasElement;
  private dustBakedW = 0;
  private dustBakedH = 0;

  /** Number of layers to render (0 = disabled). Set by configure(). */
  private layerCount = 3;
  /** Whether to render the dust haze. Set by configure(). */
  private dustEnabled = true;

  /**
   * @param seed Optional PRNG seed for deterministic generation.
   *             Pass the match seed to get a consistent background per map.
   */
  constructor(seed?: number) {
    this.dustCanvas = document.createElement('canvas');
    this.dustCanvas.width  = 1;
    this.dustCanvas.height = 1;

    // All sprite generation happens here — never again per-frame.
    this.generate(seed ?? ASTEROID_FIELD_CONFIG.seed);
  }

  // -------------------------------------------------------------------------
  // Quality configuration
  // -------------------------------------------------------------------------

  /**
   * Apply a VisualQualityPreset.  Forces the dust haze to be re-baked
   * at the next draw call.
   */
  configure(preset: VisualQualityPreset): void {
    this.layerCount  = preset.asteroidFieldLayers;
    this.dustEnabled = preset.dustHazeEnabled;
    // Invalidate the baked dust canvas so it is rebuilt at the right size.
    this.dustBakedW = 0;
    this.dustBakedH = 0;
  }

  // -------------------------------------------------------------------------
  // Sprite + placement generation (called once in constructor)
  // -------------------------------------------------------------------------

  /**
   * Generate all asteroid instances and cached sprites from the given seed.
   * This is the only place where polygon drawing and canvas allocation occur.
   */
  private generate(seed: number): void {
    const rng = mulberry32(seed);
    const cfg = ASTEROID_FIELD_CONFIG;

    this.layers = [];

    for (let li = 0; li < 3; li++) {
      const [rMin, rMax] = cfg.radiiRanges[li];
      const spriteSize   = cfg.spriteSizes[li];
      const count        = cfg.counts[li];

      // Generate sprite variants for this layer.
      const sprites: HTMLCanvasElement[] = [];
      for (let si = 0; si < cfg.spriteVariants; si++) {
        sprites.push(this.generateSprite(rng, spriteSize, li));
      }

      // Scatter asteroid instances across the world.
      const instances: AsteroidInstance[] = [];
      for (let i = 0; i < count; i++) {
        instances.push({
          wx:        rng() * WORLD_WIDTH,
          wy:        rng() * WORLD_HEIGHT,
          radius:    rMin + rng() * (rMax - rMin),
          spriteIdx: Math.floor(rng() * cfg.spriteVariants),
          rotation:  rng() * Math.PI * 2,
        });
      }

      this.layers.push({
        parallaxX: cfg.parallaxX[li],
        parallaxY: cfg.parallaxY[li],
        instances,
        sprites,
      });
    }
  }

  /**
   * Generate a single asteroid sprite canvas for the given layer tier.
   *
   * The sprite is a noisy irregular polygon with:
   *  - A dark reddish-brown body with a subtle depth gradient.
   *  - A warm orange/amber rim light on the sun-facing edge (upper-right).
   *  - 1–2 faint darker surface patches suggesting craters or texture.
   *
   * @param rng        Seeded PRNG function (advances state with each call).
   * @param size       Sprite canvas size in pixels (square).
   * @param layerIdx   Layer tier 0=far, 1=mid, 2=foreground.
   */
  private generateSprite(rng: () => number, size: number, layerIdx: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.clearRect(0, 0, size, size);

    const cx    = size * 0.5;
    const cy    = size * 0.5;
    const baseR = size * 0.38;  // leaves padding for glow/rim to stay inside canvas

    // --- Build irregular polygon (9–13 vertices) ---
    const numVerts = 9 + Math.floor(rng() * 5);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < numVerts; i++) {
      const angle   = (i / numVerts) * Math.PI * 2;
      const radFrac = 0.62 + rng() * 0.38;
      pts.push({
        x: cx + Math.cos(angle) * baseR * radFrac,
        y: cy + Math.sin(angle) * baseR * radFrac,
      });
    }

    // Helper: stroke the polygon as the current path (no fill/stroke yet).
    const applyPath = (): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };

    // ---- Step 1: Dark body with subtle radial gradient ----
    // Body gets slightly warmer (lighter) for foreground layer to distinguish depth.
    const [bodyInner, bodyOuter] = ASTEROID_FIELD_CONFIG.bodyColors[Math.min(layerIdx, 2)];

    const bodyGrad = ctx.createRadialGradient(cx * 0.72, cy * 0.72, 0, cx, cy, baseR * 1.1);
    bodyGrad.addColorStop(0.0, bodyInner);
    bodyGrad.addColorStop(1.0, bodyOuter);

    applyPath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // ---- Step 2: Warm orange rim lighting on the sun-facing edge ----
    // Sun is at screen fraction (0.82, -0.06), screen centre is (0.5, 0.5).
    // Direction from centre toward sun: dx=+0.32, dy=-0.56 → normalised ≈ (0.50, -0.87).
    // In the sprite local space (centred at cx,cy) the lit edge is in that direction.
    const rimDirX =  0.50;
    const rimDirY = -0.87;

    const rimStrength = ASTEROID_FIELD_CONFIG.rimStrength[Math.min(layerIdx, 2)];

    // Linear gradient running from shadow side → lit side.
    const rimShadX = cx - rimDirX * baseR;
    const rimShadY = cy - rimDirY * baseR;
    const rimLitX  = cx + rimDirX * baseR;
    const rimLitY  = cy + rimDirY * baseR;

    const rimGrad = ctx.createLinearGradient(rimShadX, rimShadY, rimLitX, rimLitY);
    rimGrad.addColorStop(0.00, 'rgba(0,0,0,0)');
    rimGrad.addColorStop(0.55, 'rgba(0,0,0,0)');
    rimGrad.addColorStop(0.74, `rgba(140,45,6,${(rimStrength * 0.35).toFixed(3)})`);
    rimGrad.addColorStop(0.87, `rgba(210,82,18,${(rimStrength * 0.72).toFixed(3)})`);
    rimGrad.addColorStop(0.95, `rgba(255,140,32,${rimStrength.toFixed(3)})`);
    rimGrad.addColorStop(1.00, `rgba(255,180,55,${(rimStrength * 0.85).toFixed(3)})`);

    ctx.save();
    applyPath();
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = rimGrad;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // ---- Step 3: Subtle surface patches (craters / texture) ----
    ctx.save();
    applyPath();
    ctx.clip();
    ctx.globalCompositeOperation = 'source-over';

    const patchCount = 1 + Math.floor(rng() * 2);  // 1–2 patches
    for (let p = 0; p < patchCount; p++) {
      const px = cx + (rng() - 0.5) * baseR * 1.4;
      const py = cy + (rng() - 0.5) * baseR * 1.4;
      const pr = baseR * (0.12 + rng() * 0.22);

      const pGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
      pGrad.addColorStop(0.0, 'rgba(0,0,0,0.28)');
      pGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
      ctx.fillStyle = pGrad;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.restore();

    return canvas;
  }

  // -------------------------------------------------------------------------
  // Dust haze baking (called when screen size changes or quality is updated)
  // -------------------------------------------------------------------------

  /**
   * Bake the warm amber dust haze into a half-resolution offscreen canvas.
   * Uses radial gradients only — no blur, no getImageData.
   * The canvas is expanded to full screen size at draw time via drawImage scaling.
   */
  private bakeDustHaze(screenW: number, screenH: number): void {
    const scale = 0.5;   // half resolution is sufficient for a soft haze
    const dw = Math.max(1, Math.ceil(screenW * scale));
    const dh = Math.max(1, Math.ceil(screenH * scale));

    this.dustCanvas.width  = dw;
    this.dustCanvas.height = dh;
    this.dustBakedW = screenW;
    this.dustBakedH = screenH;

    const ctx = this.dustCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dw, dh);

    const sunX = dw * ASTEROID_FIELD_CONFIG.sunScreenX;
    const sunY = dh * ASTEROID_FIELD_CONFIG.sunScreenY;

    // Primary haze: large warm bloom centred on the sun position.
    const r1 = Math.hypot(dw, dh) * 0.65;
    const g1 = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r1);
    g1.addColorStop(0.00, 'rgba(155,68,12,0.34)');
    g1.addColorStop(0.08, 'rgba(115,46,7,0.28)');
    g1.addColorStop(0.22, 'rgba(76,28,4,0.20)');
    g1.addColorStop(0.42, 'rgba(48,16,2,0.12)');
    g1.addColorStop(0.68, 'rgba(24,7,1,0.05)');
    g1.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, dw, dh);

    // Secondary haze: a slightly offset blob toward center for asymmetry.
    const r2 = Math.hypot(dw, dh) * 0.40;
    const h2x = dw * 0.60;
    const h2y = dh * 0.32;
    const g2 = ctx.createRadialGradient(h2x, h2y, 0, h2x, h2y, r2);
    g2.addColorStop(0.00, 'rgba(100,40,5,0.20)');
    g2.addColorStop(0.38, 'rgba(65,22,3,0.10)');
    g2.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, dw, dh);
  }

  // -------------------------------------------------------------------------
  // Per-frame rendering
  // -------------------------------------------------------------------------

  /**
   * Draw the asteroid field (dust haze + asteroid layers).
   *
   * Call after nebula.draw() / starfield.draw() and before crystalNebula.draw().
   * This keeps asteroids in front of distant stars and dust haze but behind
   * gameplay entities and crystal motes.
   *
   * @param ctx     Main canvas 2D context.
   * @param camera  Active camera (provides position and zoom).
   * @param screenW Logical screen width in CSS pixels.
   * @param screenH Logical screen height in CSS pixels.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    // Nothing to render at low quality.
    if (this.layerCount === 0 && !this.dustEnabled) return;

    // Rebuild dust haze if screen size changed or quality was updated.
    if (this.dustEnabled && (this.dustBakedW !== screenW || this.dustBakedH !== screenH)) {
      this.bakeDustHaze(screenW, screenH);
    }

    // ---- Dust haze (behind asteroid sprites) ----
    if (this.dustEnabled) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha              = ASTEROID_FIELD_CONFIG.dustHazeOpacity;
      ctx.imageSmoothingEnabled    = true;
      ctx.drawImage(this.dustCanvas, 0, 0, screenW, screenH);
      ctx.restore();
    }

    if (this.layerCount === 0) return;

    // ---- Asteroid layers: far → foreground ----
    // Drawing far first ensures nearer layers paint over them correctly.
    for (let li = 0; li < Math.min(this.layerCount, this.layers.length); li++) {
      const layer = this.layers[li];

      for (const ast of layer.instances) {
        // Screen position with parallax.
        const sx = (ast.wx - camera.position.x * layer.parallaxX) * camera.zoom + screenW * 0.5;
        const sy = (ast.wy - camera.position.y * layer.parallaxY) * camera.zoom + screenH * 0.5;

        // Screen-space radius.
        const sr = ast.radius * camera.zoom;

        // Frustum cull — skip asteroid if entirely off-screen.
        const cullPad = sr * 1.5;
        if (
          sx + cullPad < 0 || sx - cullPad > screenW ||
          sy + cullPad < 0 || sy - cullPad > screenH
        ) continue;

        const sprite          = layer.sprites[ast.spriteIdx];
        const spriteHalfWidth = sprite.width * 0.5;
        const scale           = sr / spriteHalfWidth;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ast.rotation);
        ctx.scale(scale, scale);
        ctx.drawImage(sprite, -spriteHalfWidth, -spriteHalfWidth);
        ctx.restore();
      }
    }
  }
}
