/**
 * Crystal Nebula Clouds for Gate88.
 *
 * Lightweight, pooled, viewport-aware particle-field system that sits between
 * the baked nebula/starfield and the gameplay layer.  Ships, projectiles, and
 * explosions disturb the clouds; particles spring back to their home positions
 * using soft easing and damping.
 *
 * Rendering uses tiny angular shapes (diamonds, rhombuses, 4-point glints) in
 * an additive composite mode so they feel like refractive ice-dust in space,
 * not smoke.
 *
 * Performance design:
 *  - All particles live in pre-allocated arrays, no per-frame allocation.
 *  - Particle counts are quality-scaled (0 / 0.4 / 1.0 density).
 *  - Cloud-level bounding-circle test culls entire clouds before per-particle work.
 *  - Viewport margin cull skips off-screen particles during draw.
 *  - Disturbance list is a fixed-size ring, cleared each tick.
 *  - No getImageData, no full-screen blur.
 */

import { Camera } from './camera.js';
import { GlowLayer } from './glowlayer.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import type { VisualQualityPreset } from './visualquality.js';
import { renderBudget } from './renderBudget.js';

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32 for stable, deterministic cloud layout
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Cloud region definitions
// ---------------------------------------------------------------------------

interface CloudDef {
  /** World-space center. */
  cx: number;
  cy: number;
  /** Cloud bounding radius (world units). Particles are scattered within this. */
  radius: number;
  /** Base particle count at density 1.0. */
  baseCount: number;
  /** RGB base tint for particles in this cloud (0–255). */
  r: number;
  g: number;
  b: number;
}

const CLOUD_DEFS: CloudDef[] = [
  // Player side (left) — cool cyan / ice-blue
  { cx: WORLD_WIDTH * 0.12, cy: WORLD_HEIGHT * 0.22, radius: 1000, baseCount: 395, r: 120, g: 210, b: 255 },
  { cx: WORLD_WIDTH * 0.20, cy: WORLD_HEIGHT * 0.68, radius: 820,  baseCount: 325, r: 140, g: 190, b: 255 },
  { cx: WORLD_WIDTH * 0.08, cy: WORLD_HEIGHT * 0.50, radius: 650,  baseCount: 268, r: 160, g: 150, b: 255 },
  // Centre contested — pale violet / faint magenta
  { cx: WORLD_WIDTH * 0.50, cy: WORLD_HEIGHT * 0.28, radius: 900,  baseCount: 367, r: 200, g: 140, b: 255 },
  { cx: WORLD_WIDTH * 0.50, cy: WORLD_HEIGHT * 0.72, radius: 860,  baseCount: 339, r: 220, g: 120, b: 200 },
  { cx: WORLD_WIDTH * 0.45, cy: WORLD_HEIGHT * 0.50, radius: 700,  baseCount: 310, r: 160, g: 200, b: 255 },
  // Enemy side (right) — warm amber / faint orange (sunlit)
  { cx: WORLD_WIDTH * 0.80, cy: WORLD_HEIGHT * 0.28, radius: 950,  baseCount: 381, r: 255, g: 200, b: 100 },
  { cx: WORLD_WIDTH * 0.90, cy: WORLD_HEIGHT * 0.72, radius: 820,  baseCount: 333, r: 255, g: 160, b:  80 },
  { cx: WORLD_WIDTH * 0.65, cy: WORLD_HEIGHT * 0.82, radius: 680,  baseCount: 282, r: 255, g: 180, b: 140 },
];

// ---------------------------------------------------------------------------
// Crystal mote (individual particle)
// ---------------------------------------------------------------------------

interface CrystalMote {
  x: number;       // world position
  y: number;
  homeX: number;   // rest position
  homeY: number;
  vx: number;      // velocity (world units / s)
  vy: number;
  angle: number;       // rotation (radians)
  angularVel: number;  // angular velocity (rad / s)
  size: number;        // half-size in world units
  brightness: number;  // base alpha factor (0.18–0.68)
  sparklePhase: number; // per-particle phase offset (radians)
  sparkleRate: number;  // oscillation frequency (rad / s)
  activity: number;     // 0 = calm, 1 = fully disturbed; decays each tick
  shine: number;        // 0 = calm, 1 = bright refractive flare
  /** Pre-computed CSS color prefix: "rgba(r,g,b," — append alpha and ")" */
  colorPrefix: string;
  /**
   * Shape:
   *   0 = diamond (symmetric 4-point polygon)
   *   1 = rhombus (wider diamond)
   *   2 = 4-point glint (two crossed line segments)
   */
  shape: 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// Disturbance
// ---------------------------------------------------------------------------

const MAX_DISTURBANCES = 96;

interface Disturbance {
  x: number;
  y: number;
  /** Velocity direction — used for directional (non-explosion) wakes. */
  vx: number;
  vy: number;
  radius: number;
  strength: number;
  /** True for radial blast; false for directional ship/projectile wake. */
  isExplosion: boolean;
}

// ---------------------------------------------------------------------------
// Cloud runtime object
// ---------------------------------------------------------------------------

interface Cloud {
  def: CloudDef;
  particles: CrystalMote[];
}

// ---------------------------------------------------------------------------
// Physics constants
// ---------------------------------------------------------------------------

/** Spring-back constant (larger = snappier return to home). */
const SPRING_K = 1.6;
/** Per-frame velocity damping exponent base (applied as pow(DAMPING, dt*60)). */
const DAMPING = 0.90;
/** Per-frame angular velocity damping. */
const ANGULAR_DAMPING = 0.87;
/** Activity decay rate (1/s). */
const ACTIVITY_DECAY = 1.2;
/** Shine decay rate (1/s). Higher means ship-triggered glints cool faster. */
const SHINE_DECAY = 2.6;
const VELOCITY_GLOW_SPEED = 120;

// ---------------------------------------------------------------------------
// CrystalNebula — main class
// ---------------------------------------------------------------------------

export class CrystalNebula {
  private clouds: Cloud[] = [];
  /** Pending disturbances accumulated this tick, applied in update(). */
  private pendingDist: Disturbance[] = new Array(MAX_DISTURBANCES).fill(null).map(() => ({
    x: 0, y: 0, vx: 0, vy: 0, radius: 1, strength: 0, isExplosion: false,
  }));
  private pendingDistCount = 0;

  /** Fixed reusable buffer for per-cloud near-disturbance filtering. Avoids per-frame allocation. */
  private nearDistBuf: Disturbance[] = new Array(MAX_DISTURBANCES).fill(null).map(() => ({
    x: 0, y: 0, vx: 0, vy: 0, radius: 1, strength: 0, isExplosion: false,
  }));
  private nearDistCount = 0;

  private enabled = true;
  private glowEnabled = false;
  private interactionScale = 1.0;
  private densityScale = 1.0;

  private screenW = 800;
  private screenH = 600;

  /** Debug counter: number of motes drawn last frame. */
  visibleMoteCount = 0;

  constructor() {
    this.buildClouds(1.0);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Apply a visual quality preset. Rebuilds particle arrays if density changed. */
  configure(preset: VisualQualityPreset): void {
    const newEnabled = preset.crystalNebulaEnabled;
    const newDensity = preset.crystalNebulaDensityScale;
    const changed = newEnabled !== this.enabled || Math.abs(newDensity - this.densityScale) > 0.01;

    this.enabled = newEnabled;
    this.densityScale = newDensity;
    this.glowEnabled = preset.crystalNebulaGlow;
    this.interactionScale = preset.crystalNebulaInteractionScale;

    if (changed) {
      this.buildClouds(this.enabled ? this.densityScale : 0);
    }
  }

  /** Notify of screen resize so viewport culling stays accurate. */
  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;
  }

  /**
   * Add a directional disturbance (ship / fighter / projectile wake).
   * Call once per entity per tick; the list is cleared after update().
   */
  addDisturbance(x: number, y: number, vx: number, vy: number, radius: number, strength: number): void {
    if (!this.enabled || this.pendingDistCount >= MAX_DISTURBANCES) return;
    const d = this.pendingDist[this.pendingDistCount++];
    d.x = x; d.y = y; d.vx = vx; d.vy = vy;
    d.radius = radius; d.strength = strength; d.isExplosion = false;
  }

  /**
   * Add several directional disturbances along a beam/laser path.
   * This lets instant line weapons push a full corridor through the crystals.
   */
  addBeamDisturbance(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    radius: number,
    strength: number,
    maxSamples: number = 8,
  ): void {
    if (!this.enabled || this.pendingDistCount >= MAX_DISTURBANCES) return;
    const dx = endX - startX;
    const dy = endY - startY;
    const len = Math.hypot(dx, dy);
    if (len <= 0.001) {
      this.addDisturbance(startX, startY, 0, 0, radius, strength);
      return;
    }
    const samples = Math.max(2, Math.min(maxSamples, Math.ceil(len / Math.max(80, radius * 1.6))));
    const vx = (dx / len) * 950;
    const vy = (dy / len) * 950;
    for (let i = 0; i < samples && this.pendingDistCount < MAX_DISTURBANCES; i++) {
      const t = samples === 1 ? 0 : i / (samples - 1);
      const falloff = 1 - Math.abs(t - 0.5) * 0.45;
      this.addDisturbance(
        startX + dx * t,
        startY + dy * t,
        vx,
        vy,
        radius,
        strength * falloff,
      );
    }
  }

  /**
   * Add a radial explosion disturbance that pushes particles outward and
   * spins them.  Call once when an explosion occurs.
   */
  addExplosion(x: number, y: number, strength: number, radius: number): void {
    if (!this.enabled || this.pendingDistCount >= MAX_DISTURBANCES) return;
    const d = this.pendingDist[this.pendingDistCount++];
    d.x = x; d.y = y; d.vx = 0; d.vy = 0;
    d.radius = radius; d.strength = strength; d.isExplosion = true;
  }

  /**
   * Advance particle physics by one tick.
   * Call from the fixed-rate update loop (60 Hz) after disturbances are injected.
   */
  update(dt: number): void {
    if (!this.enabled) {
      this.pendingDistCount = 0;
      return;
    }

    const springK    = SPRING_K;
    const damping    = Math.pow(DAMPING, dt * 60);
    const angDamping = Math.pow(ANGULAR_DAMPING, dt * 60);
    const actDecay   = Math.exp(-ACTIVITY_DECAY * dt);
    const shineDecay = Math.exp(-SHINE_DECAY * dt);
    const iScale     = this.interactionScale;
    const dc         = this.pendingDistCount;
    const dists      = this.pendingDist;

    for (const cloud of this.clouds) {
      if (cloud.particles.length === 0) continue;

      // Pre-compute cloud outer radius squared for disturbance proximity check.
      const cloudRTest = cloud.def.radius * 1.6;
      const cloudRTest2 = cloudRTest * cloudRTest;
      const ccx = cloud.def.cx;
      const ccy = cloud.def.cy;

      // Identify which disturbances are close enough to affect this cloud.
      // Re-use the pre-allocated nearDistBuf to avoid per-frame garbage.
      let nearDistCount = 0;
      for (let di = 0; di < dc; di++) {
        const dist = dists[di];
        const ddx = dist.x - ccx;
        const ddy = dist.y - ccy;
        if (ddx * ddx + ddy * ddy <= cloudRTest2) {
          CrystalNebula.copyDisturbance(this.nearDistBuf[nearDistCount], dist);
          nearDistCount++;
        }
      }
      this.nearDistCount = nearDistCount;

      for (const p of cloud.particles) {
        // Spring force toward home position
        const dxH = p.homeX - p.x;
        const dyH = p.homeY - p.y;
        p.vx += dxH * springK * dt;
        p.vy += dyH * springK * dt;

        // Apply nearby disturbances
        for (let di = 0; di < nearDistCount; di++) {
          const dist = this.nearDistBuf[di];
          const dpx = p.x - dist.x;
          const dpy = p.y - dist.y;
          const distR = dist.radius;
          const dist2 = dpx * dpx + dpy * dpy;
          if (dist2 >= distR * distR) continue;

          const distLen = Math.sqrt(dist2) + 0.001;
          const falloff = 1 - distLen / distR;
          const pushStr = dist.strength * falloff * iScale;
          const nx = dpx / distLen;
          const ny = dpy / distLen;
          const wakeSpeed = Math.min(1.8, Math.hypot(dist.vx, dist.vy) / 360);

          if (dist.isExplosion) {
            // Radial outward push
            p.vx += nx * pushStr * 320 * dt;
            p.vy += ny * pushStr * 320 * dt;
            p.angularVel += (Math.random() * 2 - 1) * pushStr * 10 * dt;
            p.activity = Math.min(1, p.activity + pushStr * 0.9);
            p.shine = Math.min(1, p.shine + pushStr * 0.75);
          } else {
            // Directional wake: shove motes aside while a little forward drag
            // gives the cloud a trailing wake behind ships and weapon fire.
            const radialPush = 230 + wakeSpeed * 150;
            p.vx += nx * pushStr * radialPush * dt;
            p.vy += ny * pushStr * radialPush * dt;
            p.vx += dist.vx * pushStr * 0.052 * dt;
            p.vy += dist.vy * pushStr * 0.052 * dt;
            p.angularVel += (dist.vx * ny - dist.vy * nx) * pushStr * 0.0045 * dt;
            p.activity = Math.min(1, p.activity + pushStr * (0.34 + wakeSpeed * 0.12));
            p.shine = Math.min(1, p.shine + pushStr * (0.48 + wakeSpeed * 0.18));
          }
        }

        // Integrate velocity into position
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.angularVel * dt;

        // Damping
        p.vx *= damping;
        p.vy *= damping;
        p.angularVel *= angDamping;
        p.activity  *= actDecay;
        p.shine     *= shineDecay;

        // Advance sparkle phase (wraps naturally via sine)
        p.sparklePhase += p.sparkleRate * dt;
      }
    }

    // Clear disturbances for next tick
    this.pendingDistCount = 0;
  }

  /**
   * Draw all visible crystal motes.
   * Call from the render loop after starfield, before spacefluid.
   * `glowLayer` may be null or disabled; glow is skipped in that case.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    glowLayer: GlowLayer | null,
    _preset: VisualQualityPreset,
  ): void {
    if (!this.enabled) return;

    const zoom  = camera.zoom;
    const camX  = camera.position.x;
    const camY  = camera.position.y;
    const hw    = this.screenW * 0.5;
    const hh    = this.screenH * 0.5;
    const time  = performance.now() * 0.001; // seconds (for sparkle)

    // World-space viewport bounds with a margin so particles don't pop in/out
    const margin = 150; // world units
    const vpMinX = camX - hw / zoom - margin;
    const vpMaxX = camX + hw / zoom + margin;
    const vpMinY = camY - hh / zoom - margin;
    const vpMaxY = camY + hh / zoom + margin;

    const useGlow = this.glowEnabled && glowLayer !== null && glowLayer.enabled;
    const glowCtx = useGlow ? glowLayer!.ctx : null;

    // Adaptive draw decimation: under load, draw every Nth mote to reduce fill cost.
    // renderLoadScale=1.0 → drawEveryN=1; renderLoadScale=0.35 → drawEveryN=3
    const loadScale = renderBudget.renderLoadScale;
    const drawEveryN = loadScale >= 0.85 ? 1 : loadScale >= 0.6 ? 2 : 3;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    let visCount = 0;

    for (const cloud of this.clouds) {
      const cd = cloud.def;
      // Cull entire cloud if its bounding circle doesn't overlap the viewport
      if (
        cd.cx + cd.radius < vpMinX || cd.cx - cd.radius > vpMaxX ||
        cd.cy + cd.radius < vpMinY || cd.cy - cd.radius > vpMaxY
      ) continue;

      let moteIdx = 0;
      for (const p of cloud.particles) {
        // Particle-level viewport cull
        if (p.x < vpMinX || p.x > vpMaxX || p.y < vpMinY || p.y > vpMaxY) { moteIdx++; continue; }

        // Adaptive draw decimation — skip every Nth mote under load
        if (drawEveryN > 1 && (moteIdx % drawEveryN) !== 0) { moteIdx++; continue; }
        moteIdx++;

        const sx = (p.x - camX) * zoom + hw;
        const sy = (p.y - camY) * zoom + hh;
        const sr = Math.max(0.4, p.size * zoom);
        const velocityGlow = Math.min(1, Math.hypot(p.vx, p.vy) / VELOCITY_GLOW_SPEED);

        // Sparkle: brightness oscillates with phase; activity/shine add a boost.
        const sparkle   = 0.68 + 0.32 * Math.sin(time * p.sparkleRate + p.sparklePhase);
        const shinePulse = p.shine * (0.72 + 0.28 * Math.sin(time * 10.0 + p.sparklePhase * 1.7));
        const actBoost  = 1 + p.activity * 1.35 + shinePulse * 2.15 + velocityGlow * 2.1;
        const alpha     = Math.min(0.96, p.brightness * sparkle * actBoost);
        if (alpha < 0.02) continue;

        const colorStr = p.colorPrefix + alpha.toFixed(3) + ')';
        const hotAlpha = Math.min(0.92, shinePulse * 0.64 + p.activity * 0.16 + velocityGlow * 0.58);
        const ca = Math.cos(p.angle);
        const sa = Math.sin(p.angle);

        if (p.shape === 2) {
          // 4-point glint: two perpendicular line segments
          const len = sr * 2.4;
          ctx.strokeStyle = hotAlpha > 0.22 ? p.colorPrefix + Math.min(1, alpha + hotAlpha * 0.4).toFixed(3) + ')' : colorStr;
          ctx.lineWidth   = Math.max(0.4, sr * 0.55);
          ctx.beginPath();
          ctx.moveTo(sx - ca * len, sy - sa * len);
          ctx.lineTo(sx + ca * len, sy + sa * len);
          ctx.moveTo(sx + sa * len, sy - ca * len);
          ctx.lineTo(sx - sa * len, sy + ca * len);
          ctx.stroke();

          // Route brightest glints into the glow layer
          if (glowCtx && (alpha > 0.50 || hotAlpha > 0.18 || velocityGlow > 0.16)) {
            glowCtx.fillStyle = p.colorPrefix + Math.min(0.52, alpha * 0.18 + hotAlpha * 0.30 + velocityGlow * 0.18).toFixed(3) + ')';
            glowCtx.beginPath();
            glowCtx.arc(sx, sy, sr * (3.0 + hotAlpha * 2.2 + velocityGlow * 3.2), 0, Math.PI * 2);
            glowCtx.fill();
          }
        } else {
          // Diamond / rhombus — compute rotated vertices without ctx.translate
          const hw2 = p.shape === 1 ? sr * 1.55 : sr;
          const hv2 = sr;

          ctx.fillStyle = colorStr;
          ctx.beginPath();
          ctx.moveTo(sx + hw2 * ca,        sy + hw2 * sa);        // +x axis
          ctx.lineTo(sx - hv2 * sa,        sy + hv2 * ca);        // +y axis
          ctx.lineTo(sx - hw2 * ca,        sy - hw2 * sa);        // -x axis
          ctx.lineTo(sx + hv2 * sa,        sy - hv2 * ca);        // -y axis
          ctx.closePath();
          ctx.fill();

          if (hotAlpha > 0.10) {
            const edgeAlpha = Math.min(0.95, hotAlpha * 0.85);
            const lineAlpha = Math.min(0.70, hotAlpha * 0.55);
            ctx.fillStyle = `rgba(255,255,255,${edgeAlpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(sx + hw2 * ca, sy + hw2 * sa);
            ctx.lineTo(sx + (hv2 * 0.18 - hv2) * sa, sy + (hv2 - hv2 * 0.18) * ca);
            ctx.lineTo(sx + (hw2 * 0.18) * ca, sy + (hw2 * 0.18) * sa);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = `rgba(255,255,255,${lineAlpha.toFixed(3)})`;
            ctx.lineWidth = Math.max(0.35, sr * 0.22);
            ctx.beginPath();
            ctx.moveTo(sx + hw2 * ca, sy + hw2 * sa);
            ctx.lineTo(sx - hw2 * ca, sy - hw2 * sa);
            ctx.stroke();
          }

          // Route highly active diamonds into glow
          if (glowCtx && (p.activity > 0.45 || p.shine > 0.12 || velocityGlow > 0.12) && alpha > 0.30) {
            const ga = Math.min(0.54, alpha * p.activity * 0.16 + hotAlpha * 0.34 + velocityGlow * 0.22);
            glowCtx.fillStyle = p.colorPrefix + ga.toFixed(3) + ')';
            glowCtx.beginPath();
            glowCtx.arc(sx, sy, sr * (2.2 + hotAlpha * 2.8 + velocityGlow * 3.4), 0, Math.PI * 2);
            glowCtx.fill();
          }
        }

        visCount++;
      }
    }

    ctx.restore();
    this.visibleMoteCount = visCount;
    renderBudget.crystalVisible = visCount;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /** Copy all fields from src into dest (avoids object allocation). */
  private static copyDisturbance(dest: Disturbance, src: Disturbance): void {
    dest.x = src.x; dest.y = src.y;
    dest.vx = src.vx; dest.vy = src.vy;
    dest.radius = src.radius; dest.strength = src.strength;
    dest.isExplosion = src.isExplosion;
  }

  private buildClouds(densityScale: number): void {
    // Use a fixed seed so the cloud layout is identical between sessions.
    const rng = mulberry32(0xc0ffee42);
    this.clouds = [];

    for (const def of CLOUD_DEFS) {
      const count = Math.max(0, Math.round(def.baseCount * densityScale));
      const particles: CrystalMote[] = [];

      for (let i = 0; i < count; i++) {
        // Scatter within cloud using polar with square-root bias toward center.
        const r     = def.radius * Math.sqrt(rng());
        const theta = rng() * Math.PI * 2;
        const homeX = def.cx + Math.cos(theta) * r;
        const homeY = def.cy + Math.sin(theta) * r;

        // Shape distribution: diamond 58%, rhombus 28%, glint 14%
        const shapeRoll = rng();
        const shape: 0 | 1 | 2 = shapeRoll < 0.58 ? 0 : shapeRoll < 0.86 ? 1 : 2;

        // Color variation (±30) around cloud base tint, clamped to 0–255
        const cr = Math.min(255, Math.max(0, def.r + Math.round((rng() - 0.5) * 60)));
        const cg = Math.min(255, Math.max(0, def.g + Math.round((rng() - 0.5) * 60)));
        const cb = Math.min(255, Math.max(0, def.b + Math.round((rng() - 0.5) * 60)));

        particles.push({
          x: homeX, y: homeY,
          homeX, homeY,
          vx: 0, vy: 0,
          angle:        rng() * Math.PI * 2,
          angularVel:   0,
          size:         0.9 + rng() * 2.4,
          brightness:   0.28 + rng() * 0.58,
          sparklePhase: rng() * Math.PI * 2,
          sparkleRate:  0.8 + rng() * 4.0,
          activity:     0,
          shine:        0,
          colorPrefix:  `rgba(${cr},${cg},${cb},`,
          shape,
        });
      }

      this.clouds.push({ def, particles });
    }
  }
}


