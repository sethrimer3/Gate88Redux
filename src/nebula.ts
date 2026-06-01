/**
 * Nebula background layer for Gate88.
 *
 * Overlapping radial-gradient clouds are baked into a small screen-space canvas
 * whenever the viewport changes. The cached layer is stretched over the full
 * viewport every frame, preserving the soft faction-colored ambience without
 * exposing edges from a finite non-tileable world texture.
 *
 * Color scheme mirrors the two-faction world layout:
 *   - Left half: cool blue / teal (player territory)
 *   - Center: deep purple (contested border)
 *   - Right half: warm red / orange (enemy territory)
 */

import { Camera } from './camera.js';
import { getCinematicLevel } from './cinematic.js';

interface ScreenCloudDef {
  x: number;
  y: number;
  radius: number;
  stops: Array<[number, string]>;
}

const SCREEN_CLOUDS: ScreenCloudDef[] = [
  {
    x: 0.22,
    y: 0.36,
    radius: 0.82,
    stops: [
      [0, 'rgba(20,95,210,0.28)'],
      [0.48, 'rgba(0,135,185,0.11)'],
      [1, 'rgba(0,0,0,0)'],
    ],
  },
  {
    x: 0.08,
    y: 0.72,
    radius: 0.62,
    stops: [
      [0, 'rgba(0,160,200,0.12)'],
      [0.58, 'rgba(40,30,170,0.08)'],
      [1, 'rgba(0,0,0,0)'],
    ],
  },
  {
    x: 0.52,
    y: 0.56,
    radius: 0.72,
    stops: [
      [0, 'rgba(65,0,115,0.16)'],
      [0.62, 'rgba(90,35,145,0.07)'],
      [1, 'rgba(0,0,0,0)'],
    ],
  },
  {
    x: 0.54,
    y: 0.34,
    radius: 0.48,
    stops: [
      [0, 'rgba(145,95,15,0.10)'],
      [1, 'rgba(0,0,0,0)'],
    ],
  },
  {
    x: 0.82,
    y: 0.34,
    radius: 0.74,
    stops: [
      [0, 'rgba(205,55,25,0.21)'],
      [0.55, 'rgba(185,80,0,0.10)'],
      [1, 'rgba(0,0,0,0)'],
    ],
  },
  {
    x: 0.94,
    y: 0.76,
    radius: 0.58,
    stops: [
      [0, 'rgba(205,30,60,0.14)'],
      [0.62, 'rgba(180,80,0,0.08)'],
      [1, 'rgba(0,0,0,0)'],
    ],
  },
];

export class Nebula {
  private screenWisps: HTMLCanvasElement;
  private screenW = 0;
  private screenH = 0;
  private cachedCinematicLevel = -1;

  constructor() {
    this.screenWisps = document.createElement('canvas');
  }

  /**
   * Draw the cached screen-space nebula.
   * Must be called after the solid background fill and before the starfield.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    _camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    this.drawScreenWisps(ctx, screenW, screenH);
  }

  private drawScreenWisps(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const cinematicLevel = getCinematicLevel();
    if (this.screenW !== screenW || this.screenH !== screenH || this.cachedCinematicLevel !== cinematicLevel) {
      this.screenW = screenW;
      this.screenH = screenH;
      this.cachedCinematicLevel = cinematicLevel;
      const scale = 0.35;
      this.screenWisps.width = Math.max(1, Math.ceil(screenW * scale));
      this.screenWisps.height = Math.max(1, Math.ceil(screenH * scale));
      const wctx = this.screenWisps.getContext('2d');
      if (!wctx) return;
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.clearRect(0, 0, this.screenWisps.width, this.screenWisps.height);
      const w = this.screenWisps.width;
      const h = this.screenWisps.height;

      const base = wctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, 'rgba(4,21,45,0.55)');
      base.addColorStop(1, 'rgba(18,7,37,0.42)');
      wctx.fillStyle = base;
      wctx.fillRect(0, 0, w, h);

      wctx.globalCompositeOperation = 'screen';
      const radiusBase = Math.max(w, h);
      for (const cloud of SCREEN_CLOUDS) {
        const cx = w * cloud.x;
        const cy = h * cloud.y;
        const grad = wctx.createRadialGradient(cx, cy, 0, cx, cy, radiusBase * cloud.radius);
        for (const [offset, color] of cloud.stops) {
          grad.addColorStop(offset, color);
        }
        wctx.fillStyle = grad;
        wctx.fillRect(0, 0, w, h);
      }

      if (cinematicLevel >= 2) {
        const copper = wctx.createRadialGradient(w * 0.70, h * 0.42, 0, w * 0.70, h * 0.42, radiusBase * 0.78);
        copper.addColorStop(0, 'rgba(227,138,74,0.16)');
        copper.addColorStop(0.34, 'rgba(198,90,46,0.09)');
        copper.addColorStop(0.72, 'rgba(107,58,34,0.045)');
        copper.addColorStop(1, 'rgba(0,0,0,0)');
        wctx.fillStyle = copper;
        wctx.fillRect(0, 0, w, h);

        wctx.globalCompositeOperation = 'multiply';
        const contrast = wctx.createLinearGradient(0, 0, w, h);
        contrast.addColorStop(0, 'rgba(24,15,12,0.05)');
        contrast.addColorStop(0.55, 'rgba(255,255,255,0)');
        contrast.addColorStop(1, 'rgba(24,15,12,0.10)');
        wctx.fillStyle = contrast;
        wctx.fillRect(0, 0, w, h);
        wctx.globalCompositeOperation = 'screen';
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.screenWisps, 0, 0, screenW, screenH);
    ctx.restore();

    if (cinematicLevel >= 3) {
      this.drawAuroraOverlay(ctx, screenW, screenH);
    }
    if (cinematicLevel >= 4) {
      this.drawNebulaStreamer(ctx, screenW, screenH);
    }
    if (cinematicLevel >= 5) {
      this.drawAuroraCurtains(ctx, screenW, screenH);
    }
    if (cinematicLevel >= 6) {
      this.drawIonVeil(ctx, screenW, screenH);
    }
    if (cinematicLevel >= 7) {
      this.drawGalaxySmear(ctx, screenW, screenH);
    }
    if (cinematicLevel >= 8) {
      this.drawPulsarSweep(ctx, screenW, screenH);
    }
  }

  /**
   * Animated aurora shimmer overlay — slowly drifting radial color washes that
   * create organic background movement absent from levels 1 and 2.
   * Drawn every frame (not baked) using performance.now() as a time source.
   * At level 4 the auroras are denser and a fourth golden wash is added.
   */
  private drawAuroraOverlay(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const t = performance.now() / 1000;
    const radiusBase = Math.max(screenW, screenH);
    const level = getCinematicLevel();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // Alpha multiplier: level 4 auroras are stronger.
    const am = level >= 4 ? 1.45 : 1.0;

    // Teal-green aurora — drifts slowly toward the top-left quadrant.
    const ta = (0.028 + 0.012 * Math.sin(t * 0.23)) * am;
    const tg = ctx.createRadialGradient(
      screenW * (0.26 + 0.11 * Math.sin(t * 0.14)),
      screenH * (0.28 + 0.09 * Math.sin(t * 0.17 + 1.1)),
      0,
      screenW * (0.26 + 0.11 * Math.sin(t * 0.14)),
      screenH * (0.28 + 0.09 * Math.sin(t * 0.17 + 1.1)),
      radiusBase * (0.52 + 0.06 * Math.sin(t * 0.09)),
    );
    tg.addColorStop(0, `rgba(0,255,175,${ta.toFixed(3)})`);
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, screenW, screenH);

    // Magenta aurora — slowly wanders near the center.
    const ma = (0.020 + 0.009 * Math.sin(t * 0.19 + 0.8)) * am;
    const mg = ctx.createRadialGradient(
      screenW * (0.56 + 0.09 * Math.sin(t * 0.11 + 2.3)),
      screenH * (0.44 + 0.07 * Math.sin(t * 0.13 + 0.5)),
      0,
      screenW * (0.56 + 0.09 * Math.sin(t * 0.11 + 2.3)),
      screenH * (0.44 + 0.07 * Math.sin(t * 0.13 + 0.5)),
      radiusBase * (0.38 + 0.05 * Math.sin(t * 0.07 + 1.0)),
    );
    mg.addColorStop(0, `rgba(220,55,220,${ma.toFixed(3)})`);
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, screenW, screenH);

    // Soft blue aurora — drifts in the lower-right region.
    const ba = (0.026 + 0.011 * Math.sin(t * 0.21 + 1.5)) * am;
    const bg = ctx.createRadialGradient(
      screenW * (0.76 + 0.08 * Math.sin(t * 0.16 + 1.7)),
      screenH * (0.70 + 0.06 * Math.sin(t * 0.12 + 3.1)),
      0,
      screenW * (0.76 + 0.08 * Math.sin(t * 0.16 + 1.7)),
      screenH * (0.70 + 0.06 * Math.sin(t * 0.12 + 3.1)),
      radiusBase * (0.44 + 0.04 * Math.sin(t * 0.10 + 2.0)),
    );
    bg.addColorStop(0, `rgba(35,140,255,${ba.toFixed(3)})`);
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, screenW, screenH);

    // Level 4 only: fourth golden-amber aurora that drifts across the upper-center,
    // adding a warm accent absent from all lower cinematic levels.
    if (level >= 4) {
      const ga = (0.022 + 0.010 * Math.sin(t * 0.16 + 3.4)) * am;
      const gg = ctx.createRadialGradient(
        screenW * (0.48 + 0.12 * Math.sin(t * 0.09 + 0.7)),
        screenH * (0.18 + 0.08 * Math.sin(t * 0.13 + 2.1)),
        0,
        screenW * (0.48 + 0.12 * Math.sin(t * 0.09 + 0.7)),
        screenH * (0.18 + 0.08 * Math.sin(t * 0.13 + 2.1)),
        radiusBase * (0.46 + 0.06 * Math.sin(t * 0.11 + 1.3)),
      );
      gg.addColorStop(0, `rgba(255,185,40,${ga.toFixed(3)})`);
      gg.addColorStop(0.55, `rgba(200,120,20,${(ga * 0.38).toFixed(3)})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, screenW, screenH);
    }

    ctx.restore();
  }

  /**
   * Level 4 only: a slow diagonal nebula streamer — a faint luminous ribbon
   * that drifts across the screen using a tilted linear gradient.  This adds
   * a structural, directional quality to the background not present at level 3,
   * making the space feel like light is propagating from a distant source.
   */
  private drawNebulaStreamer(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const t = performance.now() / 1000;

    // The streamer shifts very slowly diagonally.
    const drift = (t * 0.018) % 1;
    const ox = screenW * drift * 0.3;
    const oy = screenH * drift * 0.15;

    // Tilt the gradient across the screen (top-right → bottom-left axis).
    const x0 = screenW * 0.65 + ox;
    const y0 = -screenH * 0.10 + oy;
    const x1 = screenW * 0.25 + ox;
    const y1 = screenH * 1.10 + oy;

    const alpha = 0.028 + 0.010 * Math.sin(t * 0.07 + 1.8);
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0.00, 'rgba(0,0,0,0)');
    grad.addColorStop(0.35, `rgba(140,80,200,${alpha.toFixed(3)})`);
    grad.addColorStop(0.50, `rgba(180,120,255,${(alpha * 1.6).toFixed(3)})`);
    grad.addColorStop(0.65, `rgba(140,80,200,${alpha.toFixed(3)})`);
    grad.addColorStop(1.00, 'rgba(0,0,0,0)');

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, screenW, screenH);
    ctx.restore();
  }

  /**
   * Level 5 only: faint flowing aurora curtains made of multiple soft ribbons.
   * This adds layered structure and motion detail without increasing brightness.
   */
  private drawAuroraCurtains(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const t = performance.now() / 1000;
    const ribbons = [
      { x: 0.20, y: 0.18, dx: 0.10, speed: 0.12, hue: '90,180,255', alpha: 0.018 },
      { x: 0.52, y: 0.14, dx: 0.12, speed: 0.10, hue: '120,255,180', alpha: 0.014 },
      { x: 0.78, y: 0.22, dx: 0.08, speed: 0.14, hue: '255,155,90', alpha: 0.013 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const r of ribbons) {
      const sx = screenW * (r.x + Math.sin(t * r.speed + r.x * 8) * r.dx);
      const sy = screenH * r.y;
      const ex = sx + screenW * (0.06 + 0.03 * Math.sin(t * (r.speed * 0.7) + r.y * 5));
      const grad = ctx.createLinearGradient(sx, sy, ex, screenH * 1.08);
      const a = r.alpha + 0.004 * Math.sin(t * (r.speed * 2.6) + r.x * 11);
      grad.addColorStop(0.00, `rgba(${r.hue},${(a * 0.25).toFixed(3)})`);
      grad.addColorStop(0.26, `rgba(${r.hue},${a.toFixed(3)})`);
      grad.addColorStop(0.68, `rgba(${r.hue},${(a * 0.55).toFixed(3)})`);
      grad.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, screenW, screenH);
    }
    ctx.restore();
  }

  /**
   * Level 6: ion veil lattice made of soft crossing stream-lines.
   * Adds long-form structure depth beyond the level-5 curtain ribbons.
   */
  private drawIonVeil(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const t = performance.now() / 1000;
    const lines = 4;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < lines; i++) {
      const phase = i * 1.2 + t * 0.07;
      const x0 = screenW * (0.10 + i * 0.22 + 0.08 * Math.sin(phase));
      const y0 = screenH * (-0.15 + 0.05 * Math.sin(phase * 1.6 + i));
      const x1 = screenW * (0.92 - i * 0.16 + 0.06 * Math.sin(phase * 0.7 + 1.3));
      const y1 = screenH * (1.10 + 0.07 * Math.sin(phase * 1.1 + 2.1));
      const a = 0.010 + 0.004 * Math.sin(t * 0.19 + i * 1.7);
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0.00, 'rgba(0,0,0,0)');
      grad.addColorStop(0.22, `rgba(90,160,255,${(a * 0.85).toFixed(3)})`);
      grad.addColorStop(0.50, `rgba(175,120,255,${(a * 1.40).toFixed(3)})`);
      grad.addColorStop(0.76, `rgba(120,255,205,${(a * 0.95).toFixed(3)})`);
      grad.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.2, screenW * 0.0016);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(
        screenW * (0.30 + 0.07 * Math.sin(phase * 1.4)),
        screenH * (0.26 + 0.05 * Math.sin(phase * 1.8)),
        screenW * (0.66 + 0.08 * Math.sin(phase * 1.2 + 2.4)),
        screenH * (0.74 + 0.05 * Math.sin(phase * 1.5 + 1.1)),
        x1,
        y1,
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Level 7: deep-field galaxy smear — a scattering of faint, tiny elliptical
   * brushstrokes distributed across the background at very low alpha.  Each
   * smear represents a distant galaxy glimpsed through the nebula.  They drift
   * imperceptibly slowly and vary in color from warm amber to cool blue-violet,
   * adding sublime depth without competing with gameplay elements.
   */
  private drawGalaxySmear(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const t = performance.now() / 1000;

    // Seeded layout — deterministic positions so galaxies don't jump on resize.
    // Using simple hash-like offsets based on index rather than a real PRNG.
    const galaxies: Array<{
      x: number; y: number; rx: number; ry: number;
      tilt: number; hue: string; driftX: number; driftY: number;
    }> = [
      { x: 0.08, y: 0.12, rx: 0.014, ry: 0.006, tilt: 0.42, hue: '255,195,120', driftX: 0.010, driftY: 0.007 },
      { x: 0.28, y: 0.78, rx: 0.011, ry: 0.004, tilt: 1.18, hue: '150,195,255', driftX: 0.008, driftY: 0.012 },
      { x: 0.55, y: 0.09, rx: 0.018, ry: 0.007, tilt: 0.75, hue: '200,170,255', driftX: 0.013, driftY: 0.006 },
      { x: 0.72, y: 0.88, rx: 0.012, ry: 0.005, tilt: 2.10, hue: '120,230,210', driftX: 0.009, driftY: 0.011 },
      { x: 0.88, y: 0.22, rx: 0.016, ry: 0.006, tilt: 0.30, hue: '255,175,140', driftX: 0.007, driftY: 0.009 },
      { x: 0.15, y: 0.50, rx: 0.010, ry: 0.004, tilt: 1.65, hue: '180,210,255', driftX: 0.011, driftY: 0.008 },
      { x: 0.42, y: 0.38, rx: 0.013, ry: 0.005, tilt: 0.95, hue: '230,200,140', driftX: 0.006, driftY: 0.010 },
      { x: 0.64, y: 0.62, rx: 0.009, ry: 0.003, tilt: 1.40, hue: '160,220,255', driftX: 0.012, driftY: 0.007 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < galaxies.length; i++) {
      const g = galaxies[i];
      const phase = i * 2.37;
      // Extremely slow drift — barely perceptible over minutes.
      const ox = Math.sin(t * g.driftX + phase) * 0.012 * screenW;
      const oy = Math.cos(t * g.driftY + phase + 1.1) * 0.010 * screenH;
      const gx = g.x * screenW + ox;
      const gy = g.y * screenH + oy;
      const alpha = 0.022 + 0.008 * Math.sin(t * (g.driftX * 0.6) + phase);

      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(g.tilt + t * 0.003);

      // Outer soft halo.
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, g.rx * screenW * 1.8);
      halo.addColorStop(0.00, `rgba(${g.hue},${(alpha * 0.90).toFixed(3)})`);
      halo.addColorStop(0.45, `rgba(${g.hue},${(alpha * 0.45).toFixed(3)})`);
      halo.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(0, 0, g.rx * screenW * 1.8, g.ry * screenH * 1.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Bright core streak.
      ctx.fillStyle = `rgba(${g.hue},${Math.min(1, alpha * 2.2).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, g.rx * screenW, g.ry * screenH, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Level 8: pulsar sweep beams — two fan-shaped light beams that rotate very
   * slowly from the upper-left corner of the screen, sweeping across the nebula
   * like lighthouse beams from a distant neutron star.  Each beam is a wedge
   * gradient that fades from an off-screen source point to transparent,
   * distinct from the ion veil (level 6) crossing line-segments.  The beams
   * counter-rotate so they occasionally cross, producing brief interference
   * flares where their alpha values stack under screen blend.
   */
  private drawPulsarSweep(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const t = performance.now() / 1000;

    // Pulsar origin — fixed off the upper-left corner.
    const ox = screenW * -0.08;
    const oy = screenH * -0.12;

    const beams = [
      { speed: 0.022, phase: 0.00, hue: '160,220,255', halfAngle: 0.09, alpha: 0.016 },
      { speed: -0.016, phase: 1.57, hue: '220,170,255', halfAngle: 0.12, alpha: 0.013 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (const b of beams) {
      const angle = t * b.speed + b.phase;
      const a = b.alpha + 0.005 * Math.sin(t * (b.speed * 3.1) + b.phase * 2.3);

      // Beam length must reach diagonally across the whole screen.
      const beamLen = Math.hypot(screenW, screenH) * 1.3;

      // Centre direction and perpendicular half-width at tip.
      const cx = Math.cos(angle);
      const cy = Math.sin(angle);
      const px = -Math.sin(angle);
      const py =  Math.cos(angle);
      const halfTip = beamLen * Math.tan(b.halfAngle);

      const tipCx = ox + cx * beamLen;
      const tipCy = oy + cy * beamLen;
      const tip1X = tipCx + px * halfTip;
      const tip1Y = tipCy + py * halfTip;
      const tip2X = tipCx - px * halfTip;
      const tip2Y = tipCy - py * halfTip;

      const grad = ctx.createLinearGradient(ox, oy, tipCx, tipCy);
      grad.addColorStop(0.00, `rgba(${b.hue},0)`);
      grad.addColorStop(0.18, `rgba(${b.hue},${(a * 0.60).toFixed(3)})`);
      grad.addColorStop(0.50, `rgba(${b.hue},${a.toFixed(3)})`);
      grad.addColorStop(0.82, `rgba(${b.hue},${(a * 0.55).toFixed(3)})`);
      grad.addColorStop(1.00, 'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tip1X, tip1Y);
      ctx.lineTo(tip2X, tip2Y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}
