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
  }
}
