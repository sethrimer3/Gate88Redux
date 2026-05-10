/**
 * AI doctrine personalities for Gate 88's enemy base planner.
 *
 * Each doctrine changes:
 *   • Ring building recipes (what structures appear in each ring).
 *   • Number of radial spokes (connectivity / redundancy).
 *   • Ring gap probability per difficulty (intentional weak points).
 *   • Raid preferences and cooldown.
 *   • Whether the AI places forward bastions and local power islands.
 *
 * Doctrines are chosen deterministically from the match seed so every
 * replay of the same match produces the same opponent personality.
 */

import type { RingRole } from './aibaseplan.js';

export type DoctrineType = 'balanced' | 'turtle' | 'swarm' | 'artillery' | 'raider' | 'adaptive';

export interface DoctrineRingRecipe {
  /** Approximate distance from Command Post in grid cells. */
  radius: number;
  /** Building keys to attempt, in priority order. */
  buildings: string[];
  /** How many of each. */
  counts: Record<string, number>;
  /** Semantic role affects targeting and repair priority. */
  role: RingRole;
}

export interface Doctrine {
  type: DoctrineType;
  label: string;
  ringRecipes: DoctrineRingRecipe[];
  /**
   * Number of spokes per difficulty index (0=Easy … 4=Nightmare).
   * Spokes are radial conduit paths from the Command Post to outer rings.
   */
  spokesPerDifficulty: [number, number, number, number, number];
  /**
   * Probability that an arc segment in a ring is left empty, per difficulty
   * index. 0 = no gaps, 0.5 = half the segments are open.
   */
  gapProbPerDifficulty: [number, number, number, number, number];
  /**
   * Multiplier applied to the base raid cooldown (lower = more raids).
   * 1.0 is the baseline; Swarm uses 0.6 for frequent raids.
   */
  raidCooldownMul: number;
  /**
   * Preferred raid types, in priority order. The raid planner tries these
   * in sequence and uses the first that finds a valid target.
   */
  favoredRaidTypes: string[];
  /**
   * Whether this doctrine builds forward bastions in the outer areas.
   * Raider uses these heavily; Turtle avoids them.
   */
  useForwardBastions: boolean;
  /**
   * Whether outer bastions use independent local Power Generators rather
   * than relying solely on spoke connectivity.
   */
  useLocalPowerIslands: boolean;
  /**
   * Outer ring index at which builder drones start requesting fighter escorts.
   * -1 disables escorts; lower values escort earlier (more protective).
   */
  escortStartRing: number;
}

// ---------------------------------------------------------------------------
// Doctrine definitions
// ---------------------------------------------------------------------------

const BALANCED: Doctrine = {
  type: 'balanced',
  label: 'Balanced',
  ringRecipes: [
    {
      radius: 4, role: 'innerDefense',
      buildings: ['powergenerator', 'missileturret', 'wall'],
      counts: { powergenerator: 2, missileturret: 2, wall: 1 },
    },
    {
      radius: 8, role: 'production',
      buildings: ['powergenerator', 'fighteryard', 'missileturret', 'exciterturret', 'factory'],
      counts: { powergenerator: 2, fighteryard: 1, missileturret: 2, exciterturret: 1, factory: 1 },
    },
    {
      radius: 12, role: 'production',
      buildings: ['researchlab', 'massdriverturret', 'powergenerator', 'missileturret', 'factory'],
      counts: { researchlab: 1, massdriverturret: 2, powergenerator: 2, missileturret: 2, factory: 1 },
    },
    {
      radius: 16, role: 'picket',
      buildings: ['bomberyard', 'massdriverturret', 'exciterturret', 'powergenerator', 'fighteryard'],
      counts: { bomberyard: 1, massdriverturret: 2, exciterturret: 2, powergenerator: 2, fighteryard: 1 },
    },
  ],
  spokesPerDifficulty: [2, 3, 4, 5, 6],
  gapProbPerDifficulty: [0.40, 0.25, 0.15, 0.07, 0.02],
  raidCooldownMul: 1.0,
  favoredRaidTypes: ['probe', 'shipyard_sup', 'conduit_cut', 'retaliation', 'punishment'],
  useForwardBastions: false,
  useLocalPowerIslands: false,
  escortStartRing: 3,
};

const TURTLE: Doctrine = {
  type: 'turtle',
  label: 'Turtle',
  ringRecipes: [
    {
      radius: 3, role: 'innerDefense',
      buildings: ['missileturret', 'powergenerator', 'regenturret', 'wall'],
      counts: { missileturret: 3, powergenerator: 2, regenturret: 1, wall: 2 },
    },
    {
      radius: 7, role: 'innerDefense',
      buildings: ['missileturret', 'powergenerator', 'exciterturret', 'wall', 'factory'],
      counts: { missileturret: 3, powergenerator: 2, exciterturret: 2, wall: 2, factory: 1 },
    },
    {
      radius: 11, role: 'production',
      buildings: ['massdriverturret', 'powergenerator', 'fighteryard', 'missileturret', 'researchlab'],
      counts: { massdriverturret: 3, powergenerator: 2, fighteryard: 1, missileturret: 2, researchlab: 1 },
    },
    {
      radius: 15, role: 'picket',
      buildings: ['missileturret', 'powergenerator', 'exciterturret', 'regenturret'],
      counts: { missileturret: 3, powergenerator: 2, exciterturret: 2, regenturret: 2 },
    },
  ],
  spokesPerDifficulty: [3, 4, 5, 6, 6],
  gapProbPerDifficulty: [0.30, 0.18, 0.10, 0.04, 0.01],
  raidCooldownMul: 1.8,   // fewer raids — it turtles
  favoredRaidTypes: ['retaliation', 'probe', 'conduit_cut', 'punishment'],
  useForwardBastions: false,
  useLocalPowerIslands: false,
  escortStartRing: 2,
};

const SWARM: Doctrine = {
  type: 'swarm',
  label: 'Swarm',
  ringRecipes: [
    {
      radius: 4, role: 'production',
      buildings: ['fighteryard', 'powergenerator', 'missileturret'],
      counts: { fighteryard: 2, powergenerator: 2, missileturret: 1 },
    },
    {
      radius: 8, role: 'production',
      buildings: ['fighteryard', 'powergenerator', 'exciterturret', 'factory'],
      counts: { fighteryard: 2, powergenerator: 2, exciterturret: 1, factory: 1 },
    },
    {
      radius: 12, role: 'production',
      buildings: ['fighteryard', 'bomberyard', 'powergenerator', 'missileturret', 'researchlab'],
      counts: { fighteryard: 2, bomberyard: 1, powergenerator: 2, missileturret: 1, researchlab: 1 },
    },
    {
      radius: 16, role: 'picket',
      buildings: ['fighteryard', 'powergenerator', 'exciterturret'],
      counts: { fighteryard: 3, powergenerator: 2, exciterturret: 2 },
    },
  ],
  spokesPerDifficulty: [2, 3, 3, 4, 5],
  gapProbPerDifficulty: [0.45, 0.30, 0.20, 0.10, 0.04],
  raidCooldownMul: 0.55,   // very frequent raids
  favoredRaidTypes: ['probe', 'shipyard_sup', 'punishment', 'retaliation', 'conduit_cut'],
  useForwardBastions: false,
  useLocalPowerIslands: false,
  escortStartRing: 4,      // swarm doesn't escort — it just rushes
};

const ARTILLERY: Doctrine = {
  type: 'artillery',
  label: 'Artillery',
  ringRecipes: [
    {
      radius: 3, role: 'innerDefense',
      buildings: ['massdriverturret', 'powergenerator', 'wall'],
      counts: { massdriverturret: 3, powergenerator: 2, wall: 1 },
    },
    {
      radius: 7, role: 'innerDefense',
      buildings: ['massdriverturret', 'powergenerator', 'missileturret', 'factory'],
      counts: { massdriverturret: 3, powergenerator: 2, missileturret: 2, factory: 1 },
    },
    {
      radius: 11, role: 'production',
      buildings: ['massdriverturret', 'powergenerator', 'fighteryard', 'researchlab'],
      counts: { massdriverturret: 3, powergenerator: 2, fighteryard: 1, researchlab: 1 },
    },
    {
      radius: 15, role: 'picket',
      buildings: ['massdriverturret', 'powergenerator', 'exciterturret', 'missileturret'],
      counts: { massdriverturret: 4, powergenerator: 2, exciterturret: 2, missileturret: 2 },
    },
  ],
  spokesPerDifficulty: [3, 4, 5, 6, 6],
  gapProbPerDifficulty: [0.35, 0.22, 0.12, 0.05, 0.01],
  raidCooldownMul: 1.3,
  favoredRaidTypes: ['conduit_cut', 'retaliation', 'probe', 'shipyard_sup', 'punishment'],
  useForwardBastions: false,
  useLocalPowerIslands: false,
  escortStartRing: 2,
};

const RAIDER: Doctrine = {
  type: 'raider',
  label: 'Raider',
  ringRecipes: [
    {
      radius: 4, role: 'production',
      buildings: ['fighteryard', 'powergenerator', 'exciterturret'],
      counts: { fighteryard: 1, powergenerator: 2, exciterturret: 1 },
    },
    {
      radius: 8, role: 'production',
      buildings: ['fighteryard', 'bomberyard', 'powergenerator', 'missileturret', 'factory'],
      counts: { fighteryard: 2, bomberyard: 1, powergenerator: 2, missileturret: 1, factory: 1 },
    },
    {
      radius: 13, role: 'forward',
      buildings: ['fighteryard', 'powergenerator', 'exciterturret', 'researchlab'],
      counts: { fighteryard: 2, powergenerator: 2, exciterturret: 2, researchlab: 1 },
    },
    {
      radius: 18, role: 'forward',
      buildings: ['fighteryard', 'powergenerator', 'missileturret', 'bomberyard'],
      counts: { fighteryard: 3, powergenerator: 2, missileturret: 2, bomberyard: 1 },
    },
  ],
  spokesPerDifficulty: [2, 2, 3, 4, 5],
  gapProbPerDifficulty: [0.50, 0.35, 0.22, 0.12, 0.05],
  raidCooldownMul: 0.7,
  favoredRaidTypes: ['punishment', 'shipyard_sup', 'conduit_cut', 'probe', 'retaliation'],
  useForwardBastions: true,
  useLocalPowerIslands: true,
  escortStartRing: 2,
};

// Adaptive starts as Balanced but can shift when the planner detects player patterns.
const ADAPTIVE: Doctrine = {
  ...BALANCED,
  type: 'adaptive',
  label: 'Adaptive',
  raidCooldownMul: 0.9,
  favoredRaidTypes: ['probe', 'retaliation', 'shipyard_sup', 'conduit_cut', 'punishment'],
};

export const DOCTRINES: Record<DoctrineType, Doctrine> = {
  balanced:  BALANCED,
  turtle:    TURTLE,
  swarm:     SWARM,
  artillery: ARTILLERY,
  raider:    RAIDER,
  adaptive:  ADAPTIVE,
};

/**
 * Pick a doctrine deterministically from the match seed.
 * Weighted toward Balanced so most matches feel "normal".
 */
export function pickDoctrine(seed: number): DoctrineType {
  // Simple weighted table: balanced appears twice for 1/3 chance.
  const table: DoctrineType[] = [
    'balanced', 'balanced', 'turtle', 'swarm', 'artillery', 'raider', 'adaptive',
  ];
  const h = ((seed * 1274126177) >>> 0) / 0x100000000;
  return table[Math.floor(h * table.length)];
}
