/**
 * Vs. AI configuration.
 *
 * Distinct from PracticeConfig: Vs. AI is an opposing player-like bot
 * with its own main ship. Cheater options here are explicitly opt-in.
 */

import type { DifficultyName } from './practiceconfig.js';
import type { RaceSelection } from './confluence.js';

export const VSAI_RANKED_SCORE_KEY = 'gate88.vsai.rankedHighestScore';
export const RANKED_MAX_RANK = 3000;

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
    case 'Zenith': return 360;
  }
}

export function effectiveApm(cfg: VsAIConfig): number {
  if (cfg.ranked) return rankedApm(cfg.aiRank);
  return cfg.aiApm >= 0 ? cfg.aiApm : derivedApm(cfg.difficulty);
}

export function rankedDifficultyName(rank: number): DifficultyName {
  const t = clampRank(rank) / RANKED_MAX_RANK;
  if (t < 0.18) return 'Easy';
  if (t < 0.38) return 'Normal';
  if (t < 0.62) return 'Hard';
  if (t < 0.82) return 'Expert';
  if (t < 0.94) return 'Nightmare';
  return 'Zenith';
}

export function rankedApm(rank: number): number {
  const t = clampRank(rank) / RANKED_MAX_RANK;
  // Ranked APM is derived from normalized rank over the full ranked ladder.
  // The curve keeps the low end playable (10 APM at rank 0) while reserving
  // the sharpest reaction speed for the top of Zenith (500 APM at rank 3000).
  return Math.round(10 + (500 - 10) * Math.pow(t, 1.45));
}

export function effectiveDifficultyScalar(cfg: VsAIConfig): number {
  if (!cfg.ranked) {
    switch (cfg.difficulty) {
      case 'Easy': return 0;
      case 'Normal': return 1;
      case 'Hard': return 2;
      case 'Expert': return 3;
      case 'Nightmare': return 4;
      case 'Zenith': return 5;
    }
  }
  const t = clampRank(cfg.aiRank) / RANKED_MAX_RANK;
  return 5 * Math.pow(t, 1.08);
}

export function rankedCheaterModifierCount(cfg: VsAIConfig): number {
  return (cfg.cheatFullMapKnowledge ? 1 : 0) + (cfg.cheat125xResources ? 1 : 0);
}

export function rankedScoreMultiplier(cfg: VsAIConfig): number {
  if (!cfg.ranked) return 1;
  // Each ranked cheat is +0.25 additively, so both together are x1.5 total.
  return 1 + 0.25 * rankedCheaterModifierCount(cfg);
}

export function rankedScore(cfg: VsAIConfig): number {
  return Math.max(0, Math.round(clampRank(cfg.aiRank) * rankedScoreMultiplier(cfg)));
}

export function rankedMaxScore(): number {
  return Math.round(RANKED_MAX_RANK * 1.5);
}

export function clampRank(rank: number): number {
  return Math.max(0, Math.min(RANKED_MAX_RANK, rank));
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
    cheatFullMapKnowledge: previous?.cheatFullMapKnowledge ?? RANKED_VSAI_CONFIG.cheatFullMapKnowledge,
    cheat125xResources: previous?.cheat125xResources ?? RANKED_VSAI_CONFIG.cheat125xResources,
  };
}

