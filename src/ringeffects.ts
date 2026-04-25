/**
 * Lightweight ring-pulse effects for Gate 88.
 *
 * Two visual events:
 *   • {@link RingPulse} — an expanding ring drawn outward from a centre.
 *     Used for enemy-ring power waves (when a ring of structures completes
 *     and energizes) and as a generic "thing happened here" sweep.
 *   • {@link BlackoutRipple} — same shape, drawn in a danger colour, used
 *     to indicate that an enemy power network just lost a section.
 *
 * Effects own their entire lifetime: lifeSeconds counts down, expandRate
 * controls outward speed (world units / sec). The renderer reads alpha
 * from the remaining life ratio. No allocations after construction.
 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS } from './colors.js';

export type EffectKind = 'power_wave' | 'blackout';

export interface RingEffect {
  kind: EffectKind;
  center: Vec2;
  /** Initial radius in world units. */
  startRadius: number;
  /** Final radius — interpolated linearly. */
  endRadius: number;
  /** Total seconds the effect should live. */
  totalSeconds: number;
  /** Seconds remaining. */
  lifeSeconds: number;
  /**
   * Optional ring tint multiplier — 1 = use default colour for the kind,
   * < 1 dampens, > 1 brightens. Defaults to 1.
   */
  intensity: number;
}

export class RingEffectSystem {
  private effects: RingEffect[] = [];

  /** Spawn a green/blue power wave at `center`. */
  spawnPowerWave(center: Vec2, startRadius: number, endRadius: number,
                 lifeSeconds: number = 1.4, intensity: number = 1.0): void {
    this.effects.push({
      kind: 'power_wave',
      center: center.clone(),
      startRadius,
      endRadius,
      totalSeconds: lifeSeconds,
      lifeSeconds,
      intensity,
    });
  }

  /** Spawn a red blackout ripple — used when an enemy power link is severed. */
  spawnBlackout(center: Vec2, startRadius: number, endRadius: number,
                lifeSeconds: number = 1.0, intensity: number = 1.0): void {
    this.effects.push({
      kind: 'blackout',
      center: center.clone(),
      startRadius,
      endRadius,
      totalSeconds: lifeSeconds,
      lifeSeconds,
      intensity,
    });
  }

  update(dt: number): void {
    for (const e of this.effects) e.lifeSeconds -= dt;
    if (this.effects.length > 0) {
      this.effects = this.effects.filter((e) => e.lifeSeconds > 0);
    }
  }

  /** Cap the active list so a runaway loop can't OOM us. */
  prune(maxLive: number = 64): void {
    if (this.effects.length > maxLive) {
      this.effects.splice(0, this.effects.length - maxLive);
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.effects.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.effects) {
      const t = 1 - e.lifeSeconds / e.totalSeconds; // 0..1
      const r = e.startRadius + (e.endRadius - e.startRadius) * t;
      const alpha = (1 - t) * e.intensity;
      const screen = camera.worldToScreen(e.center);
      const radiusPx = r * camera.zoom;
      const color =
        e.kind === 'power_wave'
          ? colorToCSS(Colors.particles_friendly_exhaust, 0.6 * alpha)
          : colorToCSS(Colors.alert1, 0.7 * alpha);

      // Outer ring
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();

      // Inner softer ring trailing the leading edge
      const innerR = Math.max(2, radiusPx - 8);
      ctx.strokeStyle =
        e.kind === 'power_wave'
          ? colorToCSS(Colors.radar_friendly_status, 0.35 * alpha)
          : colorToCSS(Colors.enemyfire, 0.4 * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, innerR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Active count, primarily for tests / debug overlays. */
  count(): number {
    return this.effects.length;
  }
}
