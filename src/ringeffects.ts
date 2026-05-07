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

export type EffectKind =
  | 'power_wave'
  | 'blackout'
  | 'shockwave'
  | 'emp_wave'
  | 'build_complete_wave'
  | 'power_restore_wave'
  | 'blackout_wave';

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
  private maxLive = 64;

  setMaxLive(maxLive: number): void {
    this.maxLive = Math.max(8, Math.floor(maxLive));
    this.prune(this.maxLive);
  }

  spawn(kind: EffectKind, center: Vec2, startRadius: number, endRadius: number,
        lifeSeconds: number = 1.0, intensity: number = 1.0): void {
    this.effects.push({
      kind,
      center: center.clone(),
      startRadius,
      endRadius,
      totalSeconds: lifeSeconds,
      lifeSeconds,
      intensity,
    });
    this.prune(this.maxLive);
  }

  /** Spawn a green/blue power wave at `center`. */
  spawnPowerWave(center: Vec2, startRadius: number, endRadius: number,
                 lifeSeconds: number = 1.4, intensity: number = 1.0): void {
    this.spawn('power_wave', center, startRadius, endRadius, lifeSeconds, intensity);
  }

  /** Spawn a red blackout ripple — used when an enemy power link is severed. */
  spawnBlackout(center: Vec2, startRadius: number, endRadius: number,
                lifeSeconds: number = 1.0, intensity: number = 1.0): void {
    this.spawn('blackout', center, startRadius, endRadius, lifeSeconds, intensity);
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
      if (!camera.isOnScreen(e.center, r + 40)) continue;
      const palette = this.paletteFor(e.kind);

      // Outer ring
      ctx.strokeStyle = colorToCSS(palette.outer, palette.outerAlpha * alpha);
      ctx.lineWidth = palette.width;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();

      // Inner softer ring trailing the leading edge
      const innerR = Math.max(2, radiusPx - palette.gap);
      ctx.strokeStyle = colorToCSS(palette.inner, palette.innerAlpha * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, innerR, 0, Math.PI * 2);
      ctx.stroke();

      if (palette.dashed) {
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -t * 32;
        ctx.strokeStyle = colorToCSS(palette.inner, 0.22 * alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radiusPx * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  private paletteFor(kind: EffectKind): {
    outer: typeof Colors[keyof typeof Colors];
    inner: typeof Colors[keyof typeof Colors];
    outerAlpha: number;
    innerAlpha: number;
    width: number;
    gap: number;
    dashed: boolean;
  } {
    switch (kind) {
      case 'shockwave':
        return { outer: Colors.particles_switch, inner: Colors.explosion, outerAlpha: 0.62, innerAlpha: 0.32, width: 2.5, gap: 10, dashed: false };
      case 'emp_wave':
        return { outer: Colors.particles_spark, inner: Colors.radar_allied_status, outerAlpha: 0.56, innerAlpha: 0.28, width: 2, gap: 12, dashed: true };
      case 'build_complete_wave':
      case 'power_restore_wave':
      case 'power_wave':
        return { outer: Colors.particles_friendly_exhaust, inner: Colors.radar_friendly_status, outerAlpha: 0.6, innerAlpha: 0.35, width: 2, gap: 8, dashed: false };
      case 'blackout_wave':
      case 'blackout':
        return { outer: Colors.alert1, inner: Colors.enemyfire, outerAlpha: 0.7, innerAlpha: 0.4, width: 2, gap: 8, dashed: true };
    }
  }

  /** Active count, primarily for tests / debug overlays. */
  count(): number {
    return this.effects.length;
  }
}

