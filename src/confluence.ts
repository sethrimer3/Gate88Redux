import { Team } from './entities.js';
import { GRID_CELL_SIZE } from './grid.js';

export type FactionType = 'conduit' | 'confluence';

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

export function isConfluenceFaction(factionByTeam: Map<Team, FactionType>, team: Team): boolean {
  return factionByTeam.get(team) === 'confluence';
}
