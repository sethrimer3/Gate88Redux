import { BuildingBase } from './building.js';
import { EntityType, Team } from './entities.js';
import { GRID_CELL_SIZE, type CellCoord } from './grid.js';
import { footprintForBuildingType } from './buildingfootprint.js';

export interface BuildingShipCollisionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function buildingBlocksShips(building: BuildingBase): boolean {
  if (building.type === EntityType.FighterYard) return false;
  if (building.type === EntityType.BomberYard) return false;
  if (building.type === EntityType.Factory) return false;
  if (building.type === EntityType.ResearchLab) return false;
  if (building.type === EntityType.CommandPost && building.team === Team.Player) return false;
  return true;
}

export function buildingFootprintOrigin(building: BuildingBase): CellCoord {
  const size = footprintForBuildingType(building.type);
  return {
    cx: Math.round(building.position.x / GRID_CELL_SIZE - size / 2),
    cy: Math.round(building.position.y / GRID_CELL_SIZE - size / 2),
  };
}

export function buildingShipCollisionRect(building: BuildingBase, inflate = 0): BuildingShipCollisionRect {
  const size = footprintForBuildingType(building.type);
  const halfSide = size * GRID_CELL_SIZE * 0.5;
  return {
    left: building.position.x - halfSide - inflate,
    right: building.position.x + halfSide + inflate,
    top: building.position.y - halfSide - inflate,
    bottom: building.position.y + halfSide + inflate,
  };
}
