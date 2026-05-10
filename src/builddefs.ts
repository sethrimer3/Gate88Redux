/**
 * Central building definitions for Gate88.
 *
 * Single source of truth for everything the menu, HUD, placement, and AI
 * need to know about each placeable building type. Replaces the scattered
 * cost / build-time / display tables previously inlined across
 * `actionmenu.ts`, `game.ts`, `hud.ts`, and `constants.ts`.
 *
 * Each `BuildDef` includes a `factory(pos, team)` that returns the proper
 * concrete entity, so callers can place a building purely by key:
 *
 *     const def = getBuildDef('factory');
 *     const ent = def.factory(worldPos, Team.Player);
 *
 * `tier` lets the action-menu radial group buildings into "general" vs
 * "turret" submenus without hard-coding a list.
 */

import { Vec2 } from './math.js';
import { Team, EntityType } from './entities.js';
import {
  BuildingBase,
  CommandPost,
  PowerGenerator,
  Wall,
  Shipyard,
  ResearchLab,
  Factory,
} from './building.js';
import {
  MissileTurret,
  ExciterTurret,
  MassDriverTurret,
  RegenTurret,
  SynonymousMineLayer,
} from './turret.js';
import { BUILDING_COST, BUILD_TIME } from './constants.js';
import { TICK_RATE } from './constants.js';
import { footprintForBuildingType } from './buildingfootprint.js';

export type BuildTier = 'structure' | 'turret' | 'yard';

export interface BuildDef {
  /** Unique key — what `selectedBuildType`, menus, and placement use. */
  key: string;
  /** Human display name, e.g. "Power Generator". */
  label: string;
  /** Optional one-line subtitle (currently unused — reserved for HUD). */
  description?: string;
  /** Resource cost to place. */
  cost: number;
  /** Square grid footprint side length, in cells. */
  footprintCells: number;
  /** Build time in ticks (60 ticks = 1 second). */
  buildTime: number;
  /** Action-menu submenu this building lives in. */
  tier: BuildTier;
  /**
   * Multi-line label for the radial menu — `\n` splits onto multiple lines
   * inside the item circle. Falls back to {@link label} if absent.
   */
  radialLabel?: string;
  /**
   * If true, item is hidden from the build menu (e.g. command post is only
   * shown when the player has none).
   */
  hidden?: boolean;
  /** Research item required before this build menu entry is exposed. */
  researchKey?: string;
  /** Construct the concrete building entity at `pos` for `team`. */
  factory: (pos: Vec2, team: Team) => BuildingBase;
}

export function buildTicksToSeconds(buildTimeTicks: number): number {
  return Math.max(0, buildTimeTicks) / TICK_RATE;
}

export function createBuildingFromDef(def: BuildDef, pos: Vec2, team: Team): BuildingBase {
  const building = def.factory(pos, team);
  building.buildDurationSeconds = buildTicksToSeconds(def.buildTime);
  building.buildProgress = def.buildTime <= 0 ? 1 : 0;
  return building;
}

/**
 * Cost to rebuild the command post. Not in `BUILDING_COST` because the CP
 * starts pre-built; only relevant after the player loses theirs.
 */
export const COMMANDPOST_REBUILD_COST = 300;
/** Build time for a rebuilt command post (matches power generator pacing). */
export const COMMANDPOST_REBUILD_TIME = BUILD_TIME.powergenerator;

export const BUILD_DEFS: Record<string, BuildDef> = {
  commandpost: {
    key: 'commandpost',
    label: 'Command Post',
    cost: COMMANDPOST_REBUILD_COST,
    footprintCells: 6,
    buildTime: COMMANDPOST_REBUILD_TIME,
    tier: 'structure',
    radialLabel: 'Command\nPost',
    hidden: true, // shown by menu only when no player CP exists
    factory: (pos, team) => new CommandPost(pos, team),
  },
  powergenerator: {
    key: 'powergenerator',
    label: 'Power Generator',
    cost: BUILDING_COST.powergenerator,
    footprintCells: 3,
    buildTime: BUILD_TIME.powergenerator,
    tier: 'structure',
    radialLabel: 'Power\nGenerator',
    factory: (pos, team) => new PowerGenerator(pos, team),
  },
  wall: {
    key: 'wall',
    label: 'Wall',
    cost: BUILDING_COST.wall,
    footprintCells: 2,
    buildTime: BUILD_TIME.wall,
    tier: 'structure',
    factory: (pos, team) => new Wall(pos, team),
  },
  fighteryard: {
    key: 'fighteryard',
    label: 'Fighter Yard',
    cost: BUILDING_COST.fighteryard,
    footprintCells: 5,
    buildTime: BUILD_TIME.fighteryard,
    tier: 'yard',
    radialLabel: 'Fighter\nYard',
    factory: (pos, team) => new Shipyard(EntityType.FighterYard, pos, team),
  },
  bomberyard: {
    key: 'bomberyard',
    label: 'Bomber Yard',
    cost: BUILDING_COST.bomberyard,
    footprintCells: 6,
    buildTime: BUILD_TIME.bomberyard,
    tier: 'yard',
    radialLabel: 'Bomber\nYard',
    researchKey: 'bomberyard',
    factory: (pos, team) => new Shipyard(EntityType.BomberYard, pos, team),
  },
  researchlab: {
    key: 'researchlab',
    label: 'Research Lab',
    cost: BUILDING_COST.researchlab,
    footprintCells: 4,
    buildTime: BUILD_TIME.researchlab,
    tier: 'structure',
    radialLabel: 'Research\nLab',
    factory: (pos, team) => new ResearchLab(pos, team),
  },
  factory: {
    key: 'factory',
    label: 'Factory',
    cost: BUILDING_COST.factory,
    footprintCells: 4,
    buildTime: BUILD_TIME.factory,
    tier: 'structure',
    factory: (pos, team) => new Factory(pos, team),
  },
  missileturret: {
    key: 'missileturret',
    label: 'Missile Turret',
    cost: BUILDING_COST.missileturret,
    footprintCells: 3,
    buildTime: BUILD_TIME.missileturret,
    tier: 'turret',
    radialLabel: 'Missile\nTurret',
    factory: (pos, team) => new MissileTurret(pos, team),
  },
  synonymousminelayer: {
    key: 'synonymousminelayer',
    label: 'Mine Layer',
    cost: BUILDING_COST.synonymousminelayer,
    footprintCells: 5,
    buildTime: BUILD_TIME.synonymousminelayer,
    tier: 'turret',
    radialLabel: 'Mine\nLayer',
    researchKey: 'synonymousminelayer',
    factory: (pos, team) => new SynonymousMineLayer(pos, team),
  },
  exciterturret: {
    key: 'exciterturret',
    label: 'Exciter Turret',
    cost: BUILDING_COST.exciterturret,
    footprintCells: 6,
    buildTime: BUILD_TIME.exciterturret,
    tier: 'turret',
    radialLabel: 'Exciter\nTurret',
    researchKey: 'exciterturret',
    factory: (pos, team) => new ExciterTurret(pos, team),
  },
  massdriverturret: {
    key: 'massdriverturret',
    label: 'Mass Driver',
    cost: BUILDING_COST.massdriverturret,
    footprintCells: 3,
    buildTime: BUILD_TIME.massdriverturret,
    tier: 'turret',
    radialLabel: 'Mass\nDriver',
    researchKey: 'massdriverturret',
    factory: (pos, team) => new MassDriverTurret(pos, team),
  },
  regenturret: {
    key: 'regenturret',
    label: 'Regen Turret',
    cost: BUILDING_COST.regenturret,
    footprintCells: 3,
    buildTime: BUILD_TIME.regenturret,
    tier: 'turret',
    radialLabel: 'Regen\nTurret',
    researchKey: 'regenturret',
    factory: (pos, team) => new RegenTurret(pos, team),
  },
};

export function buildCostForBuildingType(type: EntityType): number {
  switch (type) {
    case EntityType.CommandPost:
      return COMMANDPOST_REBUILD_COST;
    case EntityType.PowerGenerator:
      return BUILDING_COST.powergenerator;
    case EntityType.Wall:
      return BUILDING_COST.wall;
    case EntityType.FighterYard:
      return BUILDING_COST.fighteryard;
    case EntityType.BomberYard:
      return BUILDING_COST.bomberyard;
    case EntityType.ResearchLab:
      return BUILDING_COST.researchlab;
    case EntityType.Factory:
      return BUILDING_COST.factory;
    case EntityType.MissileTurret:
      return BUILDING_COST.missileturret;
    case EntityType.TimeBomb:
      return BUILDING_COST.synonymousminelayer;
    case EntityType.ExciterTurret:
      return BUILDING_COST.exciterturret;
    case EntityType.MassDriverTurret:
      return BUILDING_COST.massdriverturret;
    case EntityType.RegenTurret:
      return BUILDING_COST.regenturret;
    default:
      return 0;
  }
}

export function buildDefForEntityType(type: EntityType): BuildDef | undefined {
  switch (type) {
    case EntityType.CommandPost:
      return BUILD_DEFS.commandpost;
    case EntityType.PowerGenerator:
      return BUILD_DEFS.powergenerator;
    case EntityType.Wall:
      return BUILD_DEFS.wall;
    case EntityType.FighterYard:
      return BUILD_DEFS.fighteryard;
    case EntityType.BomberYard:
      return BUILD_DEFS.bomberyard;
    case EntityType.ResearchLab:
      return BUILD_DEFS.researchlab;
    case EntityType.Factory:
      return BUILD_DEFS.factory;
    case EntityType.MissileTurret:
      return BUILD_DEFS.missileturret;
    case EntityType.TimeBomb:
      return BUILD_DEFS.synonymousminelayer;
    case EntityType.ExciterTurret:
      return BUILD_DEFS.exciterturret;
    case EntityType.MassDriverTurret:
      return BUILD_DEFS.massdriverturret;
    case EntityType.RegenTurret:
      return BUILD_DEFS.regenturret;
    default:
      return undefined;
  }
}

/** Lookup helper that returns undefined for unknown keys. */
export function getBuildDef(key: string): BuildDef | undefined {
  return BUILD_DEFS[key];
}

/** All defs in the given tier, in stable insertion order. */
export function defsByTier(tier: BuildTier): BuildDef[] {
  return Object.values(BUILD_DEFS).filter((d) => d.tier === tier);
}

