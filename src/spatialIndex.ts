import { Entity } from './entities.js';
import { Vec2 } from './math.js';

export interface SpatialIndexStats {
  queryCount: number;
  candidateCount: number;
  insertedCount: number;
  cellCount: number;
}

/**
 * Lightweight broadphase for world entities.
 *
 * The game mutates entity positions in many places, so the safest model is a
 * rebuild at known tick points instead of per-entity incremental updates. Query
 * callers pass a reusable output array when they are in a hot loop.
 */
export class SpatialIndex {
  private readonly cells = new Map<string, Entity[]>();
  private insertedCount = 0;
  private queryCount = 0;
  private candidateCount = 0;
  private readonly seenIds = new Set<number>();

  constructor(private readonly cellSize: number) {}

  clear(resetStats = true): void {
    this.cells.clear();
    this.insertedCount = 0;
    if (resetStats) {
      this.queryCount = 0;
      this.candidateCount = 0;
    }
  }

  insert(entity: Entity): void {
    if (!entity.alive) return;
    const minX = Math.floor((entity.position.x - entity.radius) / this.cellSize);
    const maxX = Math.floor((entity.position.x + entity.radius) / this.cellSize);
    const minY = Math.floor((entity.position.y - entity.radius) / this.cellSize);
    const maxY = Math.floor((entity.position.y + entity.radius) / this.cellSize);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const key = `${cx},${cy}`;
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(entity);
      }
    }
    this.insertedCount++;
  }

  queryCircle(center: Vec2, radius: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    this.queryCount++;
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    const seen = this.seenIds;
    seen.clear();
    const radiusSq = radius * radius;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const entity of bucket) {
          if (seen.has(entity.id) || !entity.alive) continue;
          seen.add(entity.id);
          const padded = radius + entity.radius;
          const dx = entity.position.x - center.x;
          const dy = entity.position.y - center.y;
          if (dx * dx + dy * dy <= Math.max(radiusSq, padded * padded)) {
            out.push(entity);
          }
        }
      }
    }
    this.candidateCount += out.length;
    return out;
  }

  stats(): SpatialIndexStats {
    return {
      queryCount: this.queryCount,
      candidateCount: this.candidateCount,
      insertedCount: this.insertedCount,
      cellCount: this.cells.size,
    };
  }
}
