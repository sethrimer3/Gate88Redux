/**
 * Practice-mode configuration.
 *
 * Single source of truth for all the knobs the Practice setup menu
 * exposes. PracticeMode and the enemy build planner read from this.
 *
 * Keep ranges sane — extreme values shouldn't crash the game.
 */

export type DifficultyName = 'Easy' | 'Normal' | 'Hard' | 'Expert' | 'Nightmare';

export const DIFFICULTY_NAMES: DifficultyName[] = [
  'Easy', 'Normal', 'Hard', 'Expert', 'Nightmare',
];

export type ResearchUnlock = 'none' | 'basic_turrets' | 'all_turrets' | 'full_tech';
export type VictoryCondition = 'destroy_cp' | 'survive_waves' | 'sandbox';
export type DefeatCondition = 'cp_destroyed' | 'ship_and_no_cp' | 'disabled';
export type MapSize = 'small' | 'medium' | 'large';

export interface PracticeConfig {
  difficulty: DifficultyName;
  playerStartingResources: number;
  enemyStartingResources: number;
  playerIncomeMul: number;
  enemyIncomeMul: number;
  enemyBuildSpeedMul: number;
  enemyMaxBuilders: number;
  enemyBuilderRebuildSeconds: number;
  enemyAggression: DifficultyName; // reuses the same scale
  enemyExpansionSpeed: DifficultyName;
  enemyStartingBaseSize: 'tiny' | 'small' | 'medium';
  fogOfWar: boolean;
  mapSize: MapSize;
  startingDistance: number; // player ↔ enemy CP, world units
  researchUnlocked: ResearchUnlock;
  victoryCondition: VictoryCondition;
  defeatCondition: DefeatCondition;
}

export const DEFAULT_PRACTICE_CONFIG: PracticeConfig = {
  difficulty: 'Normal',
  playerStartingResources: 500,
  enemyStartingResources: 500,
  playerIncomeMul: 1.0,
  enemyIncomeMul: 1.0,
  enemyBuildSpeedMul: 1.0,
  enemyMaxBuilders: 5,
  enemyBuilderRebuildSeconds: 30,
  enemyAggression: 'Normal',
  enemyExpansionSpeed: 'Normal',
  enemyStartingBaseSize: 'small',
  fogOfWar: false,
  mapSize: 'medium',
  startingDistance: 2200,
  researchUnlocked: 'none',
  victoryCondition: 'destroy_cp',
  defeatCondition: 'cp_destroyed',
};

/** Numeric difficulty index 0..4 used by planner cadence / scaling. */
export function difficultyIndex(d: DifficultyName): number {
  return Math.max(0, DIFFICULTY_NAMES.indexOf(d));
}

/** Multiplier applied to AI tick frequency at higher difficulty. */
export function difficultyTickMul(d: DifficultyName): number {
  // Easy=0.6, Normal=1, Hard=1.3, Expert=1.7, Nightmare=2.2
  return [0.6, 1.0, 1.3, 1.7, 2.2][difficultyIndex(d)];
}

/** Defensive redundancy: how much the planner cross-links its rings. */
export function difficultyRedundancy(d: DifficultyName): number {
  return [0.0, 0.15, 0.3, 0.5, 0.75][difficultyIndex(d)];
}

/** Returns a fresh copy so the menu can mutate without touching the constant. */
export function cloneDefaultPracticeConfig(): PracticeConfig {
  return { ...DEFAULT_PRACTICE_CONFIG };
}
