/** Camera system for Gate88 */

import { Vec2, clamp } from './math.js';

export class Camera {
  position: Vec2 = new Vec2(0, 0);
  zoom: number = 1.0;

  /** Smoothing factor for camera follow (higher = snappier). */
  followSpeed: number = 5.0;

  private screenWidth: number = 800;
  private screenHeight: number = 600;

  // -----------------------------------------------------------------------
  // Camera shake — decays exponentially each frame
  // -----------------------------------------------------------------------

  /** Current shake offset in screen pixels. */
  private _shakeX = 0;
  private _shakeY = 0;
  /** Maximum shake magnitude (clamp applied when adding new impulses). */
  static readonly MAX_SHAKE = 10;
  /** Decay exponent: shake halves in ~1/DECAY seconds. */
  private static readonly SHAKE_DECAY = 12;

  /**
   * Request a screen-shake impulse.  Multiple simultaneous impulses are
   * additive up to MAX_SHAKE so large battles don't become seizure-inducing.
   */
  addShake(magnitude: number): void {
    const angle = Math.random() * Math.PI * 2;
    this._shakeX = clamp(this._shakeX + Math.cos(angle) * magnitude, -Camera.MAX_SHAKE, Camera.MAX_SHAKE);
    this._shakeY = clamp(this._shakeY + Math.sin(angle) * magnitude, -Camera.MAX_SHAKE, Camera.MAX_SHAKE);
  }
  /** Logical screen width (CSS pixels). */
  get screenW(): number { return this.screenWidth; }
  /** Logical screen height (CSS pixels). */
  get screenH(): number { return this.screenHeight; }

  setScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  /**
   * Convert a world-space X coordinate to screen-space X without allocating
   * a Vec2 object.  Prefer this in hot render paths over worldToScreen.
   */
  screenX(worldX: number): number {
    return (worldX - this.position.x) * this.zoom + this.screenWidth * 0.5 + this._shakeX;
  }

  /**
   * Convert a world-space Y coordinate to screen-space Y without allocating
   * a Vec2 object.  Prefer this in hot render paths over worldToScreen.
   */
  screenY(worldY: number): number {
    return (worldY - this.position.y) * this.zoom + this.screenHeight * 0.5 + this._shakeY;
  }

  /** Smoothly follow a target position. Call once per frame. */
  update(target: Vec2, dt: number): void {
    const t = clamp(this.followSpeed * dt, 0, 1);
    this.position = this.position.lerp(target, t);
    // Decay shake exponentially
    const decay = Math.exp(-Camera.SHAKE_DECAY * dt);
    this._shakeX *= decay;
    this._shakeY *= decay;
    if (Math.abs(this._shakeX) < 0.01) this._shakeX = 0;
    if (Math.abs(this._shakeY) < 0.01) this._shakeY = 0;
  }

  /** Convert a world-space position to screen-space pixel coordinates. */
  worldToScreen(pos: Vec2): Vec2 {
    return new Vec2(
      (pos.x - this.position.x) * this.zoom + this.screenWidth * 0.5 + this._shakeX,
      (pos.y - this.position.y) * this.zoom + this.screenHeight * 0.5 + this._shakeY,
    );
  }

  /** Convert a screen-space pixel position to world-space coordinates. */
  screenToWorld(pos: Vec2): Vec2 {
    // Remove shake offset before inverting
    return new Vec2(
      (pos.x - this._shakeX - this.screenWidth * 0.5) / this.zoom + this.position.x,
      (pos.y - this._shakeY - this.screenHeight * 0.5) / this.zoom + this.position.y,
    );
  }

  /** Check whether a world position is within the visible screen area (with optional margin in world units). */
  isOnScreen(pos: Vec2, margin: number = 0): boolean {
    const screen = this.worldToScreen(pos);
    return (
      screen.x >= -margin * this.zoom &&
      screen.x <= this.screenWidth + margin * this.zoom &&
      screen.y >= -margin * this.zoom &&
      screen.y <= this.screenHeight + margin * this.zoom
    );
  }
}
