export type VisualQuality = 'low' | 'medium' | 'high';

export interface VisualQualityPreset {
  readonly glowEnabled: boolean;
  readonly glowScale: number;
  readonly conduitShimmer: boolean;
  readonly shockwaveScale: number;
  readonly scanlines: boolean;
  readonly fluidLowGraphics: boolean;
}

export const VISUAL_QUALITY_PRESETS: Record<VisualQuality, VisualQualityPreset> = {
  low: {
    glowEnabled: false,
    glowScale: 0.2,
    conduitShimmer: false,
    shockwaveScale: 0.55,
    scanlines: false,
    fluidLowGraphics: true,
  },
  medium: {
    glowEnabled: true,
    glowScale: 0.25,
    conduitShimmer: true,
    shockwaveScale: 1,
    scanlines: false,
    fluidLowGraphics: true,
  },
  high: {
    glowEnabled: true,
    glowScale: 0.33,
    conduitShimmer: true,
    shockwaveScale: 1.2,
    scanlines: true,
    fluidLowGraphics: false,
  },
};

export const DEFAULT_VISUAL_QUALITY: VisualQuality = 'medium';

