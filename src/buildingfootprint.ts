import { EntityType } from './entities.js';

export function footprintForBuildingType(type: EntityType): number {
  switch (type) {
    case EntityType.CommandPost:
      return 6;
    case EntityType.Wall:
      return 2;
    case EntityType.FighterYard:
      return 5;
    case EntityType.BomberYard:
      return 6;
    case EntityType.Factory:
    case EntityType.ResearchLab:
      return 4;
    default:
      return 3;
  }
}
