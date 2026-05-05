/** Game constants for Gate88 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// World dimensions
export const WORLD_WIDTH = 8000;
export const WORLD_HEIGHT = 6000;

// Entity radii
export const ENTITY_RADIUS = {
  fighter: 3.5,
  bomber: 8,
  mainguy: 7,
  bullet: 3,
  missile: 3,
  building: 13,
  commandpost: 16,
  jumpgate: 20,
  signalstation: 12,
  explosion: 26,
} as const;

// Building costs (resource units)
export const BUILDING_COST = {
  factory: 100,
  researchlab: 150,
  powergenerator: 120,
  missileturret: 80,
  exciterturret: 100,
  massdriverturret: 90,
  regenturret: 110,
  timebomb: 60,
  signalstation: 70,
  fighteryard: 200,
  bomberyard: 250,
} as const;

// Build times (in ticks at 60fps)
export const BUILD_TIME = {
  factory: 300,
  researchlab: 360,
  powergenerator: 240,
  missileturret: 180,
  exciterturret: 210,
  massdriverturret: 200,
  regenturret: 220,
  timebomb: 120,
  signalstation: 150,
  fighteryard: 420,
  bomberyard: 480,
} as const;

// Research costs
export const RESEARCH_COST = {
  missileturret: 200,
  exciterturret: 250,
  massdriverturret: 220,
  regenturret: 240,
  timebomb: 150,
  bomberyard: 300,
  cloak: 350,
  advancedFighters: 280,
} as const;

// Research times (in ticks)
export const RESEARCH_TIME = {
  missileturret: 600,
  exciterturret: 720,
  massdriverturret: 660,
  regenturret: 680,
  timebomb: 480,
  bomberyard: 900,
  cloak: 840,
  advancedFighters: 780,
} as const;

export const PLAYER_SHIP_SCALE = 1.75;

export const ACTIVE_RESEARCH_ITEMS = [
  'missileturret',
  'exciterturret',
  'massdriverturret',
  'regenturret',
  'bomberyard',
  'advancedFighters',
] as const;

// Weapon stats
export const WEAPON_STATS = {
  fire: {
    damage: 5,
    speed: 400,
    fireRate: 10,   // ticks between shots
    range: 500,
  },
  laser: {
    damage: 8,
    speed: 600,
    fireRate: 15,
    range: 600,
  },
  missile: {
    damage: 20,
    speed: 300,
    fireRate: 40,
    range: 800,
  },
  bigfire: {
    damage: 12,
    speed: 350,
    fireRate: 20,
    range: 550,
  },
  bigmissile: {
    damage: 35,
    speed: 250,
    fireRate: 60,
    range: 900,
  },
  exciterbullet: {
    damage: 3,
    speed: 500,
    fireRate: 5,
    range: 400,
  },
  exciterbeam: {
    damage: 15,
    speed: 0,      // instant
    fireRate: 30,
    range: 350,
  },
  massdriverbullet: {
    damage: 25,
    speed: 700,
    fireRate: 45,
    range: 1000,
  },
  regenbullet: {
    damage: -10,    // heals
    speed: 400,
    fireRate: 20,
    range: 500,
  },
  bigregenbullet: {
    damage: -20,
    speed: 350,
    fireRate: 30,
    range: 600,
  },
  shortbullet: {
    damage: 4,
    speed: 450,
    fireRate: 8,
    range: 300,
  },
  minilaser: {
    damage: 6,
    speed: 550,
    fireRate: 12,
    range: 450,
  },
  firebomb: {
    damage: 40,
    speed: 200,
    fireRate: 90,
    range: 400,
  },
} as const;

// Ship stats
export const SHIP_STATS = {
  fighter: {
    health: 30,
    speed: 250,
    turnRate: 4.0,
  },
  bomber: {
    health: 60,
    speed: 180,
    turnRate: 2.5,
  },
  mainguy: {
    health: 50,
    speed: 280,
    turnRate: 5.0,
  },
} as const;

// Resource gain rate (per second per factory, as bonus)
export const RESOURCE_GAIN_RATE = 1.0;

// Baseline resource gain per second (player auto-gains resources over time)
export const BASELINE_RESOURCE_GAIN = 2.0;

// Build zone radii
export const COMMANDPOST_BUILD_RADIUS = 260;
export const POWERGENERATOR_COVERAGE_RADIUS = 195;

/** Resource cost to paint one conduit cell. */
export const CONDUIT_COST = 1;
