/**
 * Vs. AI configuration.
 *
 * Distinct from PracticeConfig: Vs. AI is an opposing player-like bot
 * with its own main ship. Cheater options here are explicitly opt-in.
 */

import type { DifficultyName } from './practiceconfig.js';

export interface VsAIConfig {
  difficulty: DifficultyName;
  /** Optional override for AI APM. -1 means "derive from difficulty". */
  aiApm: number;
  startingResources: number;
  mapSize: 'small' | 'medium' | 'large';
  startingDistance: number;
  fogOfWar: boolean;
  /** Cheat: AI sees the entire map regardless of vision. */
  cheatFullMapKnowledge: boolean;
  /** Cheat: AI resource income x1.25. */
  cheat125xResources: boolean;
}

export const DEFAULT_VSAI_CONFIG: VsAIConfig = {
  difficulty: 'Normal',
  aiApm: -1,
  startingResources: 500,
  mapSize: 'medium',
  startingDistance: 2200,
  fogOfWar: false,
  cheatFullMapKnowledge: false,
  cheat125xResources: false,
};

/** Default APM table when aiApm < 0. */
export function derivedApm(diff: DifficultyName): number {
  switch (diff) {
    case 'Easy': return 25;
    case 'Normal': return 60;
    case 'Hard': return 110;
    case 'Expert': return 180;
    case 'Nightmare': return 280;
  }
}

export function effectiveApm(cfg: VsAIConfig): number {
  return cfg.aiApm >= 0 ? cfg.aiApm : derivedApm(cfg.difficulty);
}

export function cloneDefaultVsAIConfig(): VsAIConfig {
  return { ...DEFAULT_VSAI_CONFIG };
}

