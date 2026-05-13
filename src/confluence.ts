import { Team } from './entities.js';
import { GRID_CELL_SIZE } from './grid.js';

export type FactionType = 'terran' | 'synonymous';
export type RaceSelection = FactionType | 'random';

export const FACTION_TYPES: FactionType[] = ['terran', 'synonymous'];
export const RACE_SELECTIONS: RaceSelection[] = ['terran', 'synonymous', 'random'];

export interface ConfluenceTerritoryCircle {
  id: string;
  x: number;
  y: number;
  radius: number;
  targetRadius: number;
  sourceBuildingId?: string;
  parentCircleId?: string;
  createdAt: number;
  growthStartTime: number;
  growthDuration: number;
}

export const CONDUIT_LENGTH = GRID_CELL_SIZE;
export const CONFLUENCE_BASE_RADIUS = CONDUIT_LENGTH * 5;
export const CONFLUENCE_PLACEMENT_DISTANCE = CONDUIT_LENGTH * 5;
export const CONFLUENCE_PLACEMENT_TOLERANCE = CONDUIT_LENGTH * 0.85;
export const CONFLUENCE_PARENT_EXPAND_DURATION = 0.35;
export const CONFLUENCE_NEW_CIRCLE_GROW_DURATION = 0.45;
export const CONFLUENCE_INCLUDE_MARGIN = CONDUIT_LENGTH * 0.5;

/**
 * Concentroid faction has been removed. This function always returns false and
 * is preserved only to avoid a large refactor of call-sites that safely
 * short-circuit on false.
 * @deprecated Will be removed in a future cleanup pass.
 */
export function isConfluenceFaction(_factionByTeam: Map<Team, FactionType>, _team: Team): boolean {
  return false;
}

export function isSynonymousFaction(factionByTeam: Map<Team, FactionType>, team: Team): boolean {
  return factionByTeam.get(team) === 'synonymous';
}

export function factionLabel(faction: RaceSelection): string {
  switch (faction) {
    case 'terran': return 'Terran';
    case 'synonymous': return 'The Synonymous';
    case 'random': return 'Random';
  }
}

export function resolveRaceSelection(selection: RaceSelection, salt: number = Math.random()): FactionType {
  if (selection !== 'random') return selection;
  return FACTION_TYPES[Math.abs(Math.floor(salt * 9973)) % FACTION_TYPES.length];
}
