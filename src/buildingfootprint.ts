import { EntityType } from './entities.js';

export function footprintForBuildingType(type: EntityType): number {
  switch (type) {
    case EntityType.CommandPost:
      return 6;
    case EntityType.Factory:
    case EntityType.ResearchLab:
      return 4;
    default:
      return 3;
  }
}
