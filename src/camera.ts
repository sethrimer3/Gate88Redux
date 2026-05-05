/** Camera system for Gate88 */

import { Vec2, clamp } from './math.js';

export class Camera {
  position: Vec2 = new Vec2(0, 0);
  zoom: number = 1.0;

  /** Smoothing factor for camera follow (higher = snappier). */
  followSpeed: number = 5.0;

  private screenWidth: number = 800;
  private screenHeight: number = 600;

  setScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  /** Smoothly follow a target position. Call once per frame. */
  update(target: Vec2, dt: number): void {
    const t = clamp(this.followSpeed * dt, 0, 1);
    this.position = this.position.lerp(target, t);
  }

  /** Convert a world-space position to screen-space pixel coordinates. */
  worldToScreen(pos: Vec2): Vec2 {
    return new Vec2(
      (pos.x - this.position.x) * this.zoom + this.screenWidth * 0.5,
      (pos.y - this.position.y) * this.zoom + this.screenHeight * 0.5
    );
  }

  /** Convert a screen-space pixel position to world-space coordinates. */
  screenToWorld(pos: Vec2): Vec2 {
    return new Vec2(
      (pos.x - this.screenWidth * 0.5) / this.zoom + this.position.x,
      (pos.y - this.screenHeight * 0.5) / this.zoom + this.position.y
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

