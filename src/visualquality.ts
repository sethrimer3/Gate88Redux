export type VisualQuality = 'low' | 'medium' | 'high';

export interface VisualQualityPreset {
  readonly glowEnabled: boolean;
  readonly glowScale: number;
  readonly conduitShimmer: boolean;
  readonly shockwaveScale: number;
  readonly scanlines: boolean;
  readonly fluidLowGraphics: boolean;
  /** Adds glow halos to individual bullets and gatling rounds. */
  readonly bulletGlow: boolean;
  /** Draws an animated engine trail glow behind thrusting ships in the glow layer. */
  readonly engineGlow: boolean;
  /** Renders a subtle color-fringe gradient on screen edges (CRT lens effect). */
  readonly colorFringe: boolean;
  /**
   * Fraction (0–1) of the full particle budget to emit for explosions and
   * sparks.  Low mode emits roughly 35 %, medium 65 %, high 100 %.
   */
  readonly particleScale: number;
  /** Enable animated shooting-star streaks in the background starfield. */
  readonly shootingStarsEnabled: boolean;
  /**
   * Enable small screen-shake impulses for large explosions and heavy weapon
   * impacts.  Always false in Low mode; enabled for medium/high.
   */
  readonly cameraShakeEnabled: boolean;
  /**
   * Enable traveling energy-pulse dots along powered conduits in High graphics.
   * Too CPU-intensive for Low; partial in Medium; full in High.
   */
  readonly conduitPulseEnabled: boolean;
}

export const VISUAL_QUALITY_PRESETS: Record<VisualQuality, VisualQualityPreset> = {
  low: {
    glowEnabled: false,
    glowScale: 0.2,
    conduitShimmer: false,
    shockwaveScale: 0.55,
    scanlines: false,
    fluidLowGraphics: true,
    bulletGlow: false,
    engineGlow: false,
    colorFringe: false,
    particleScale: 0.35,
    shootingStarsEnabled: false,
    cameraShakeEnabled: false,
    conduitPulseEnabled: false,
  },
  medium: {
    glowEnabled: true,
    glowScale: 0.25,
    conduitShimmer: true,
    shockwaveScale: 1,
    scanlines: false,
    fluidLowGraphics: true,
    bulletGlow: true,
    engineGlow: true,
    colorFringe: true,
    particleScale: 0.65,
    shootingStarsEnabled: true,
    cameraShakeEnabled: true,
    conduitPulseEnabled: false,
  },
  high: {
    glowEnabled: true,
    glowScale: 0.33,
    conduitShimmer: true,
    shockwaveScale: 1.2,
    scanlines: true,
    fluidLowGraphics: false,
    bulletGlow: true,
    engineGlow: true,
    colorFringe: true,
    particleScale: 1.0,
    shootingStarsEnabled: true,
    cameraShakeEnabled: true,
    conduitPulseEnabled: true,
  },
};

export const DEFAULT_VISUAL_QUALITY: VisualQuality = 'medium';

const VISUAL_QUALITY_STORAGE_KEY = 'gate88_visual_quality';

/** Load the persisted visual quality from localStorage, falling back to the default. */
export function loadVisualQuality(): VisualQuality {
  try {
    const raw = window.localStorage?.getItem(VISUAL_QUALITY_STORAGE_KEY);
    if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  } catch {
    // localStorage unavailable (e.g. private browsing with strict settings)
  }
  return DEFAULT_VISUAL_QUALITY;
}

/** Persist the given visual quality to localStorage. */
export function saveVisualQuality(quality: VisualQuality): void {
  try {
    window.localStorage?.setItem(VISUAL_QUALITY_STORAGE_KEY, quality);
  } catch {
    // Ignore write failures
  }
}

