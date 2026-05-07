/**
 * Nebula background layer for Gate88.
 *
 * Eight overlapping radial-gradient "clouds" are baked into a small offscreen
 * canvas at startup (one pixel = SCALE world units).  Each frame we blit that
 * offscreen canvas with a slow parallax (0.15× camera movement) so the nebulae
 * feel deep and distant without any per-frame gradient recalculation.
 *
 * Colour scheme mirrors the two-faction world layout:
 *   • Left half  → cool blue / teal  (player territory)
 *   • Centre     → deep purple       (contested border)
 *   • Right half → warm red / orange (enemy territory)
 */

import { Camera } from './camera.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';

/** How many world units one offscreen pixel represents. */
const SCALE = 8;

/** Parallax factor — nebulae move at 15 % of the camera speed. */
const PARALLAX = 0.15;

interface NebulaCloudDef {
  wx: number;   // world-space X centre
  wy: number;   // world-space Y centre
  rx: number;   // world-space radius X
  ry: number;   // world-space radius Y
  angle: number; // rotation (radians)
  r0: string;   // inner gradient colour (CSS rgba)
  r1: string;   // outer gradient colour (CSS rgba, typically transparent)
}

const CLOUD_DEFS: NebulaCloudDef[] = [
  // --- Player side (left half) — blue / teal ---
  {
    wx: WORLD_WIDTH * 0.12, wy: WORLD_HEIGHT * 0.20,
    rx: 1800, ry: 1100, angle: 0.3,
    r0: 'rgba(20,70,190,0.22)', r1: 'rgba(0,0,0,0)',
  },
  {
    wx: WORLD_WIDTH * 0.28, wy: WORLD_HEIGHT * 0.72,
    rx: 1400, ry:  900, angle: -0.5,
    r0: 'rgba(0,110,190,0.17)', r1: 'rgba(0,0,0,0)',
  },
  {
    wx: WORLD_WIDTH * 0.06, wy: WORLD_HEIGHT * 0.55,
    rx:  950, ry:  720, angle: 0.8,
    r0: 'rgba(40,30,170,0.15)', r1: 'rgba(0,0,0,0)',
  },
  {
    wx: WORLD_WIDTH * 0.20, wy: WORLD_HEIGHT * 0.40,
    rx:  700, ry:  550, angle: -1.1,
    r0: 'rgba(0,160,200,0.11)', r1: 'rgba(0,0,0,0)',
  },
  // --- Centre (contested) — deep purple ---
  {
    wx: WORLD_WIDTH * 0.50, wy: WORLD_HEIGHT * 0.50,
    rx: 2100, ry: 1500, angle: 0.0,
    r0: 'rgba(55,0,100,0.10)', r1: 'rgba(0,0,0,0)',
  },
  // --- Enemy side (right half) — red / orange ---
  {
    wx: WORLD_WIDTH * 0.78, wy: WORLD_HEIGHT * 0.25,
    rx: 1600, ry: 1100, angle: 0.6,
    r0: 'rgba(200,50,20,0.20)', r1: 'rgba(0,0,0,0)',
  },
  {
    wx: WORLD_WIDTH * 0.92, wy: WORLD_HEIGHT * 0.68,
    rx: 1350, ry:  960, angle: -0.3,
    r0: 'rgba(180,80,0,0.16)', r1: 'rgba(0,0,0,0)',
  },
  {
    wx: WORLD_WIDTH * 0.62, wy: WORLD_HEIGHT * 0.85,
    rx:  880, ry:  660, angle: 1.2,
    r0: 'rgba(200,20,55,0.14)', r1: 'rgba(0,0,0,0)',
  },
];

export class Nebula {
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private screenWisps: HTMLCanvasElement;
  private screenW = 0;
  private screenH = 0;

  constructor() {
    const w = Math.ceil(WORLD_WIDTH / SCALE);
    const h = Math.ceil(WORLD_HEIGHT / SCALE);
    this.offscreen = document.createElement('canvas');
    this.offscreen.width  = w;
    this.offscreen.height = h;

    const ctx = this.offscreen.getContext('2d');
    if (!ctx) throw new Error('Nebula: failed to get 2D context for offscreen canvas');
    this.offCtx = ctx;
    this.screenWisps = document.createElement('canvas');
    this.bake();
  }

  /** Render all cloud definitions into the offscreen canvas once. */
  private bake(): void {
    const ctx = this.offCtx;
    ctx.clearRect(0, 0, this.offscreen.width, this.offscreen.height);

    for (const def of CLOUD_DEFS) {
      const ox = def.wx / SCALE;
      const oy = def.wy / SCALE;
      const rx = def.rx / SCALE;
      const ry = def.ry / SCALE;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(def.angle);
      // Scale the y-axis to create an elliptical cloud from a circular gradient.
      ctx.scale(1, ry / rx);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      grad.addColorStop(0.0, def.r0);
      grad.addColorStop(1.0, def.r1);

      // Screen blending: overlapping clouds brighten the centre naturally.
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  /**
   * Blit the pre-baked nebula onto the main canvas using a slow parallax.
   * Must be called after the solid background fill and before the starfield.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    this.drawScreenWisps(ctx, screenW, screenH);

    // The nebula canvas represents the full world at 1/SCALE resolution.
    // We want world point (wx, wy) to appear at screen position:
    //   sx = (wx - camX * PARALLAX) * zoom + screenW/2
    //   sy = (wy - camY * PARALLAX) * zoom + screenH/2
    // The offscreen pixel (ox, oy) = (wx/SCALE, wy/SCALE), so:
    //   sx = ox * (SCALE * zoom) + (screenW/2 - camX * PARALLAX * zoom)
    // which is a translate (tx, ty) + uniform scale (SCALE * zoom).
    const scale = SCALE * camera.zoom;
    const tx = screenW  * 0.5 - camera.position.x * PARALLAX * camera.zoom;
    const ty = screenH * 0.5 - camera.position.y * PARALLAX * camera.zoom;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.offscreen, 0, 0);
    // On ultrawide screens the parallax world texture can start to the right
    // of x=0. Draw neighboring copies so the baked nebula always covers the
    // full viewport instead of leaving a blank strip on the left edge.
    const worldPixelsW = this.offscreen.width;
    const worldPixelsH = this.offscreen.height;
    if (tx > 0) ctx.drawImage(this.offscreen, -worldPixelsW, 0);
    if (ty > 0) ctx.drawImage(this.offscreen, 0, -worldPixelsH);
    if (tx > 0 && ty > 0) ctx.drawImage(this.offscreen, -worldPixelsW, -worldPixelsH);
    ctx.restore();
  }

  private drawScreenWisps(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (this.screenW !== screenW || this.screenH !== screenH) {
      this.screenW = screenW;
      this.screenH = screenH;
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
      const blue = wctx.createRadialGradient(w * 0.34, h * 0.45, 0, w * 0.34, h * 0.45, Math.max(w, h) * 0.78);
      blue.addColorStop(0, 'rgba(20,95,210,0.28)');
      blue.addColorStop(0.5, 'rgba(0,135,185,0.10)');
      blue.addColorStop(1, 'rgba(0,0,0,0)');
      wctx.fillStyle = blue;
      wctx.fillRect(0, 0, w, h);

      const violet = wctx.createRadialGradient(w * 0.62, h * 0.72, 0, w * 0.62, h * 0.72, Math.max(w, h) * 0.62);
      violet.addColorStop(0, 'rgba(80,25,140,0.16)');
      violet.addColorStop(1, 'rgba(0,0,0,0)');
      wctx.fillStyle = violet;
      wctx.fillRect(0, 0, w, h);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.screenWisps, 0, 0, screenW, screenH);
    ctx.restore();
  }
}

