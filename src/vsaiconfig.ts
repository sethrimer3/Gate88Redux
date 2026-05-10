/**
 * Vs. AI configuration.
 *
 * Distinct from PracticeConfig: Vs. AI is an opposing player-like bot
 * with its own main ship. Cheater options here are explicitly opt-in.
 */

import type { DifficultyName } from './practiceconfig.js';
import type { RaceSelection } from './confluence.js';

export const VSAI_RANKED_SCORE_KEY = 'gate88.vsai.rankedHighestScore';

export interface VsAIConfig {
  ranked: boolean;
  aiRank: number;
  difficulty: DifficultyName;
  playerRace: RaceSelection;
  aiRace: RaceSelection;
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
  ranked: false,
  aiRank: 1000,
  difficulty: 'Normal',
  playerRace: 'terran',
  aiRace: 'terran',
  aiApm: -1,
  startingResources: 500,
  mapSize: 'medium',
  startingDistance: 2200,
  fogOfWar: false,
  cheatFullMapKnowledge: false,
  cheat125xResources: false,
};

export const RANKED_VSAI_CONFIG: VsAIConfig = {
  ...DEFAULT_VSAI_CONFIG,
  ranked: true,
  aiRank: 1000,
  difficulty: 'Hard',
  aiApm: -1,
  startingResources: 300,
  mapSize: 'medium',
  startingDistance: 3000,
  fogOfWar: true,
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
  if (cfg.ranked) return rankedApm(cfg.aiRank);
  return cfg.aiApm >= 0 ? cfg.aiApm : derivedApm(cfg.difficulty);
}

export function rankedDifficultyName(rank: number): DifficultyName {
  const t = clampRank(rank) / 3000;
  if (t < 0.18) return 'Easy';
  if (t < 0.38) return 'Normal';
  if (t < 0.62) return 'Hard';
  if (t < 0.82) return 'Expert';
  return 'Nightmare';
}

export function rankedApm(rank: number): number {
  const t = clampRank(rank) / 3000;
  return Math.round(18 + 900 * Math.pow(t, 1.7));
}

export function effectiveDifficultyScalar(cfg: VsAIConfig): number {
  if (!cfg.ranked) {
    switch (cfg.difficulty) {
      case 'Easy': return 0;
      case 'Normal': return 1;
      case 'Hard': return 2;
      case 'Expert': return 3;
      case 'Nightmare': return 4;
    }
  }
  const t = clampRank(cfg.aiRank) / 3000;
  return 4 * Math.pow(t, 1.08);
}

function clampRank(rank: number): number {
  return Math.max(0, Math.min(3000, rank));
}

export function cloneDefaultVsAIConfig(): VsAIConfig {
  return { ...DEFAULT_VSAI_CONFIG };
}

export function cloneRankedVsAIConfig(previous?: VsAIConfig): VsAIConfig {
  return {
    ...RANKED_VSAI_CONFIG,
    aiRank: previous?.aiRank ?? RANKED_VSAI_CONFIG.aiRank,
    playerRace: previous?.playerRace ?? RANKED_VSAI_CONFIG.playerRace,
    aiRace: previous?.aiRace ?? RANKED_VSAI_CONFIG.aiRace,
  };
}

