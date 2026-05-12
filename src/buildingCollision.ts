import { BuildingBase } from './building.js';
import { EntityType, Team } from './entities.js';
import { GRID_CELL_SIZE, footprintOrigin, worldToCell } from './grid.js';
import { footprintForBuildingType } from './buildingfootprint.js';

export interface BuildingShipCollisionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function buildingBlocksShips(building: BuildingBase): boolean {
  if (building.type === EntityType.FighterYard) return false;
  if (building.type === EntityType.CommandPost && building.team === Team.Player) return false;
  return true;
}

export function buildingShipCollisionRect(building: BuildingBase, inflate = 0): BuildingShipCollisionRect {
  const c = worldToCell(building.position);
  const size = footprintForBuildingType(building.type);
  const origin = footprintOrigin(c.cx, c.cy, size);
  return {
    left: origin.cx * GRID_CELL_SIZE - inflate,
    right: (origin.cx + size) * GRID_CELL_SIZE + inflate,
    top: origin.cy * GRID_CELL_SIZE - inflate,
    bottom: (origin.cy + size) * GRID_CELL_SIZE + inflate,
  };
}
