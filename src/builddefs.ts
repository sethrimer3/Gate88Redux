/**
 * Central building definitions for Gate88 (PR4).
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
 * "turret" submenus without hard-coding a list. PR5 will add a `power`
 * entry so the power-graph code can identify suppliers/consumers from the
 * same table.
 */

import { Vec2 } from './math.js';
import { Team, EntityType } from './entities.js';
import {
  BuildingBase,
  CommandPost,
  PowerGenerator,
  Shipyard,
  ResearchLab,
  Factory,
} from './building.js';
import {
  MissileTurret,
  ExciterTurret,
  MassDriverTurret,
  RegenTurret,
} from './turret.js';
import { BUILDING_COST, BUILD_TIME } from './constants.js';

export type BuildTier = 'general' | 'turret';

export interface BuildDef {
  /** Unique key — what `selectedBuildType`, menus, and placement use. */
  key: string;
  /** Human display name, e.g. "Power Generator". */
  label: string;
  /** Optional one-line subtitle (currently unused — reserved for HUD). */
  description?: string;
  /** Resource cost to place. */
  cost: number;
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
  /** Construct the concrete building entity at `pos` for `team`. */
  factory: (pos: Vec2, team: Team) => BuildingBase;
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
    buildTime: COMMANDPOST_REBUILD_TIME,
    tier: 'general',
    radialLabel: 'Command\nPost',
    hidden: true, // shown by menu only when no player CP exists
    factory: (pos, team) => new CommandPost(pos, team),
  },
  powergenerator: {
    key: 'powergenerator',
    label: 'Power Generator',
    cost: BUILDING_COST.powergenerator,
    buildTime: BUILD_TIME.powergenerator,
    tier: 'general',
    radialLabel: 'Power\nGenerator',
    factory: (pos, team) => new PowerGenerator(pos, team),
  },
  fighteryard: {
    key: 'fighteryard',
    label: 'Fighter Yard',
    cost: BUILDING_COST.fighteryard,
    buildTime: BUILD_TIME.fighteryard,
    tier: 'general',
    radialLabel: 'Fighter\nYard',
    factory: (pos, team) => new Shipyard(EntityType.FighterYard, pos, team),
  },
  bomberyard: {
    key: 'bomberyard',
    label: 'Bomber Yard',
    cost: BUILDING_COST.bomberyard,
    buildTime: BUILD_TIME.bomberyard,
    tier: 'general',
    radialLabel: 'Bomber\nYard',
    factory: (pos, team) => new Shipyard(EntityType.BomberYard, pos, team),
  },
  researchlab: {
    key: 'researchlab',
    label: 'Research Lab',
    cost: BUILDING_COST.researchlab,
    buildTime: BUILD_TIME.researchlab,
    tier: 'general',
    radialLabel: 'Research\nLab',
    factory: (pos, team) => new ResearchLab(pos, team),
  },
  factory: {
    key: 'factory',
    label: 'Factory',
    cost: BUILDING_COST.factory,
    buildTime: BUILD_TIME.factory,
    tier: 'general',
    factory: (pos, team) => new Factory(pos, team),
  },
  missileturret: {
    key: 'missileturret',
    label: 'Missile Turret',
    cost: BUILDING_COST.missileturret,
    buildTime: BUILD_TIME.missileturret,
    tier: 'turret',
    radialLabel: 'Missile\nTurret',
    factory: (pos, team) => new MissileTurret(pos, team),
  },
  exciterturret: {
    key: 'exciterturret',
    label: 'Exciter Turret',
    cost: BUILDING_COST.exciterturret,
    buildTime: BUILD_TIME.exciterturret,
    tier: 'turret',
    radialLabel: 'Exciter\nTurret',
    factory: (pos, team) => new ExciterTurret(pos, team),
  },
  massdriverturret: {
    key: 'massdriverturret',
    label: 'Mass Driver',
    cost: BUILDING_COST.massdriverturret,
    buildTime: BUILD_TIME.massdriverturret,
    tier: 'turret',
    radialLabel: 'Mass\nDriver',
    factory: (pos, team) => new MassDriverTurret(pos, team),
  },
  regenturret: {
    key: 'regenturret',
    label: 'Regen Turret',
    cost: BUILDING_COST.regenturret,
    buildTime: BUILD_TIME.regenturret,
    tier: 'turret',
    radialLabel: 'Regen\nTurret',
    factory: (pos, team) => new RegenTurret(pos, team),
  },
};

/** Lookup helper that returns undefined for unknown keys. */
export function getBuildDef(key: string): BuildDef | undefined {
  return BUILD_DEFS[key];
}

/** All defs in the given tier, in stable insertion order. */
export function defsByTier(tier: BuildTier): BuildDef[] {
  return Object.values(BUILD_DEFS).filter((d) => d.tier === tier);
}
