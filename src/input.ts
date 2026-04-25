/** Input manager – tracks keyboard and mouse state for Gate88 */

import { Vec2 } from './math.js';

const DOUBLE_TAP_WINDOW_MS = 200;

class InputManager {
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private keysReleased = new Set<string>();

  /** Timestamps of the last key-up per key, used for double-tap detection. */
  private lastReleaseTimes = new Map<string, number>();
  private doubleTapped = new Set<string>();
  /** Fired when a key is pressed for the second time within the double-tap window (double-tap-then-hold). */
  private doubleTapDown = new Set<string>();

  mousePos = new Vec2(0, 0);
  mouseDown = false;
  mousePressed = false;
  mouseReleased = false;
  /** Right mouse button */
  mouse2Down = false;
  mouse2Pressed = false;
  mouse2Released = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key;
    // Tab and certain keys would otherwise move browser focus / scroll the page.
    // We use Tab as the full-screen radar hold key, so suppress its default.
    if (key === 'Tab') e.preventDefault();
    if (!this.keysDown.has(key)) {
      this.keysPressed.add(key);
      // Detect second press within the double-tap window (for double-tap-then-hold)
      const now = performance.now();
      const prevRelease = this.lastReleaseTimes.get(key);
      if (prevRelease !== undefined && now - prevRelease < DOUBLE_TAP_WINDOW_MS) {
        this.doubleTapDown.add(key);
      }
    }
    this.keysDown.add(key);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key;
    this.keysDown.delete(key);
    this.keysReleased.add(key);

    const now = performance.now();
    const prev = this.lastReleaseTimes.get(key);
    if (prev !== undefined && now - prev < DOUBLE_TAP_WINDOW_MS) {
      this.doubleTapped.add(key);
    }
    this.lastReleaseTimes.set(key, now);
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mousePos.set(e.clientX, e.clientY);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseDown = true;
      this.mousePressed = true;
    } else if (e.button === 2) {
      this.mouse2Down = true;
      this.mouse2Pressed = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseDown = false;
      this.mouseReleased = true;
    } else if (e.button === 2) {
      this.mouse2Down = false;
      this.mouse2Released = true;
    }
  };

  /** True while the key is held down. */
  isDown(key: string): boolean {
    return this.keysDown.has(key);
  }

  /** True only on the frame the key was first pressed. */
  wasPressed(key: string): boolean {
    return this.keysPressed.has(key);
  }

  /** True only on the frame the key was released. */
  wasReleased(key: string): boolean {
    return this.keysReleased.has(key);
  }

  /** True if the key was released twice within the double-tap window this frame. */
  isDoubleTapped(key: string): boolean {
    return this.doubleTapped.has(key);
  }

  /** True on the frame the key is pressed for the second time quickly (double-tap-then-hold). */
  isDoubleTapDown(key: string): boolean {
    return this.doubleTapDown.has(key);
  }

  /**
   * Remove a key from the held/pressed sets so it doesn't bleed through to
   * other subsystems (e.g. after a menu consumes an arrow-key press).
   */
  consumeKey(key: string): void {
    this.keysDown.delete(key);
    this.keysPressed.delete(key);
  }

  /** Call once per frame after processing input to reset per-frame states. */
  update(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.doubleTapped.clear();
    this.doubleTapDown.clear();
    this.mousePressed = false;
    this.mouseReleased = false;
    this.mouse2Pressed = false;
    this.mouse2Released = false;
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mouseup', this.onMouseUp);
    }
  }
}

export const Input = new InputManager();
