import { Entity } from './entities.js';
import { Vec2 } from './math.js';

export interface SpatialIndexStats {
  queryCount: number;
  rawCandidateCount: number;
  returnedCount: number;
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
  private readonly cells = new Map<number, Entity[]>();
  private readonly bucketPool: Entity[][] = [];
  private insertedCount = 0;
  private queryCount = 0;
  private rawCandidateCount = 0;
  private returnedCount = 0;
  private readonly seenIds = new Set<number>();

  constructor(private readonly cellSize: number) {}

  clear(resetStats = true): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.bucketPool.push(bucket);
    }
    this.cells.clear();
    this.insertedCount = 0;
    if (resetStats) {
      this.queryCount = 0;
      this.rawCandidateCount = 0;
      this.returnedCount = 0;
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
        const key = this.cellKey(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = this.bucketPool.pop() ?? [];
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
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(this.cellKey(cx, cy));
        if (!bucket) continue;
        for (const entity of bucket) {
          this.rawCandidateCount++;
          if (seen.has(entity.id) || !entity.alive) continue;
          seen.add(entity.id);
          const padded = radius + entity.radius;
          const dx = entity.position.x - center.x;
          const dy = entity.position.y - center.y;
          if (dx * dx + dy * dy <= padded * padded) {
            out.push(entity);
          }
        }
      }
    }
    this.returnedCount += out.length;
    return out;
  }

  querySegment(start: Vec2, end: Vec2, radius: number, out: Entity[] = []): Entity[] {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const mid = new Vec2(start.x + dx * 0.5, start.y + dy * 0.5);
    return this.queryCircle(mid, Math.sqrt(dx * dx + dy * dy) * 0.5 + radius, out);
  }

  stats(): SpatialIndexStats {
    return {
      queryCount: this.queryCount,
      rawCandidateCount: this.rawCandidateCount,
      returnedCount: this.returnedCount,
      insertedCount: this.insertedCount,
      cellCount: this.cells.size,
    };
  }

  private cellKey(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
}
