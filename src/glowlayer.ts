import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { type Color, colorToCSS } from './colors.js';

/**
 * Low-resolution additive glow target.
 *
 * The main canvas never gets blurred. Instead, bright primitives are redrawn
 * into this smaller buffer and upscaled with image smoothing. That gives a
 * shader-like bloom read while keeping fill cost proportional to the reduced
 * buffer size.
 */
export class GlowLayer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private screenW = 0;
  private screenH = 0;
  private scale = 0.25;
  enabled = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create glow layer');
    this.ctx = ctx;
  }

  configure(enabled: boolean, scale: number): void {
    this.enabled = enabled;
    this.scale = Math.max(0.12, Math.min(0.5, scale));
    this.resize(this.screenW, this.screenH);
  }

  resize(screenW: number, screenH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    const w = Math.max(1, Math.ceil(screenW * this.scale));
    const h = Math.max(1, Math.ceil(screenH * this.scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  begin(): void {
    if (!this.enabled) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = 1;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  compositeTo(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    ctx.save();
    // Composite in viewport coordinates from a known transform. Previously the
    // glow pass inherited the main context transform, which could leave a
    // resized/upscaled glow buffer covering only part of the screen.
    const dpr = this.screenW > 0 ? ctx.canvas.width / this.screenW : 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(
      this.canvas,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      0,
      this.screenW,
      this.screenH,
    );
    ctx.restore();
  }

  lineScreen(from: Vec2, to: Vec2, color: Color, alpha: number, width: number): void {
    if (!this.enabled || alpha <= 0 || width <= 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = colorToCSS(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  lineWorld(camera: Camera, from: Vec2, to: Vec2, color: Color, alpha: number, widthWorld: number): void {
    this.lineScreen(camera.worldToScreen(from), camera.worldToScreen(to), color, alpha, widthWorld * camera.zoom);
  }

  circleScreen(center: Vec2, radius: number, color: Color, alpha: number, fill = true, lineWidth = 1): void {
    if (!this.enabled || alpha <= 0 || radius <= 0) return;
    const ctx = this.ctx;
    if (fill) {
      ctx.fillStyle = colorToCSS(color, alpha);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = colorToCSS(color, alpha);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  circleWorld(camera: Camera, center: Vec2, radiusWorld: number, color: Color, alpha: number, fill = true, lineWidthWorld = 1): void {
    this.circleScreen(
      camera.worldToScreen(center),
      radiusWorld * camera.zoom,
      color,
      alpha,
      fill,
      lineWidthWorld * camera.zoom,
    );
  }
}
