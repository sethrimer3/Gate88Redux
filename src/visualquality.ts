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
  },
};

export const DEFAULT_VISUAL_QUALITY: VisualQuality = 'medium';

