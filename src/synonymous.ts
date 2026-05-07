import { Camera } from './camera.js';
import { Colors, colorToCSS, type Color } from './colors.js';
import { Team } from './entities.js';
import { GRID_CELL_SIZE } from './grid.js';
import { Vec2 } from './math.js';
import { teamColor } from './teamutils.js';

export const SYNONYMOUS_DRONE_DIAMETER = GRID_CELL_SIZE * 0.75;
export const SYNONYMOUS_DRONE_RADIUS = SYNONYMOUS_DRONE_DIAMETER * 0.5;
export const SYNONYMOUS_DRONE_HP = 5;
export const SYNONYMOUS_BASE_PRODUCTION = 1;
export const SYNONYMOUS_FACTORY_PRODUCTION = 1;

export const SYNONYMOUS_BUILD_COST: Record<string, number> = {
  factory: 50,
  researchlab: 50,
  missileturret: 50,
};

export type SynonymousShapeKind = 'swarm' | 'factory' | 'researchlab' | 'laserturret';

interface Drone {
  id: number;
  pos: Vec2;
  vel: Vec2;
  target: Vec2;
  hp: number;
  bornAt: number;
  awakenedAt: number;
  allocatedTo?: number;
  returning?: boolean;
}

interface Formation {
  buildingId: number;
  kind: SynonymousShapeKind;
  team: Team;
  center: Vec2;
  droneIds: number[];
  createdAt: number;
}

export class SynonymousSwarmSystem {
  private dronesByTeam = new Map<Team, Drone[]>();
  private formationsByBuilding = new Map<number, Formation>();
  private baseByTeam = new Map<Team, Vec2>();
  private nextDroneId = 1;

  setBase(team: Team, center: Vec2): void {
    this.baseByTeam.set(team, center.clone());
    if (!this.dronesByTeam.has(team)) this.dronesByTeam.set(team, []);
  }

  clearTeam(team: Team): void {
    this.dronesByTeam.delete(team);
    this.baseByTeam.delete(team);
    for (const [id, f] of this.formationsByBuilding) {
      if (f.team === team) this.formationsByBuilding.delete(id);
    }
  }

  droneCount(team: Team): number {
    return this.dronesByTeam.get(team)?.filter((d) => !d.allocatedTo).length ?? 0;
  }

  totalDroneCount(team: Team): number {
    return this.dronesByTeam.get(team)?.length ?? 0;
  }

  canSpend(team: Team, amount: number): boolean {
    return this.droneCount(team) >= amount;
  }

  spawnAtBase(team: Team, amount: number, time: number): void {
    const base = this.baseByTeam.get(team);
    if (!base) return;
    for (let i = 0; i < amount; i++) {
      const a = ((this.nextDroneId * 137.508) % 360) * Math.PI / 180;
      const r = 20 + Math.sqrt(this.totalDroneCount(team) + i) * 4.5;
      this.addDrone(team, base.add(new Vec2(Math.cos(a) * r, Math.sin(a) * r)), time);
    }
  }

  produce(team: Team, amount: number, origin: Vec2, time: number): void {
    for (let i = 0; i < amount; i++) {
      const a = ((this.nextDroneId * 97.31) % 360) * Math.PI / 180;
      const p = origin.add(new Vec2(Math.cos(a) * 10, Math.sin(a) * 10));
      this.addDrone(team, p, time);
    }
  }

  shapeLine(team: Team, target: Vec2): void {
    const base = this.baseByTeam.get(team);
    const drones = this.dronesByTeam.get(team);
    if (!base || !drones) return;
    const free = drones.filter((d) => !d.allocatedTo);
    const dist = Math.max(1, base.distanceTo(target));
    const dir = target.sub(base).normalize();
    const perp = new Vec2(-dir.y, dir.x);
    const wanted = Math.min(free.length, Math.max(8, Math.floor(dist / (SYNONYMOUS_DRONE_RADIUS * 1.35))));
    for (let i = 0; i < wanted; i++) {
      const t = wanted <= 1 ? 0 : i / (wanted - 1);
      const width = Math.max(SYNONYMOUS_DRONE_RADIUS * 0.6, SYNONYMOUS_DRONE_RADIUS * 4.5 * (1 - t));
      const wave = Math.sin(i * 2.17 + dist * 0.01) * width;
      free[i].target = base.add(dir.scale(dist * t)).add(perp.scale(wave));
      free[i].returning = false;
    }
  }

  recallAt(team: Team, pos: Vec2): boolean {
    const drones = this.dronesByTeam.get(team);
    const base = this.baseByTeam.get(team);
    if (!drones || !base) return false;
    let changed = false;
    for (const d of drones) {
      if (d.allocatedTo) continue;
      if (d.pos.distanceTo(pos) <= SYNONYMOUS_DRONE_RADIUS * 2.5) {
        d.target = base.clone();
        d.returning = true;
        changed = true;
      }
    }
    return changed;
  }

  allocateToBuilding(team: Team, buildingId: number, kind: SynonymousShapeKind, center: Vec2, cost: number, time: number): boolean {
    const drones = this.dronesByTeam.get(team) ?? [];
    const free = drones.filter((d) => !d.allocatedTo).sort((a, b) => a.pos.distanceTo(center) - b.pos.distanceTo(center));
    if (free.length < cost) return false;
    const visibleCount = Math.min(cost, kind === 'laserturret' ? 18 : kind === 'factory' ? 24 : 20);
    const selected = free.slice(0, cost);
    const visible = selected.slice(0, visibleCount);
    const visibleIds: number[] = [];
    for (let i = 0; i < selected.length; i++) {
      const d = selected[i];
      d.allocatedTo = buildingId;
      if (i < visibleCount) {
        d.target = this.formationPoint(kind, center, i, visibleCount);
        d.awakenedAt = time + i * 0.018;
        visibleIds.push(d.id);
      } else {
        d.hp = 0;
      }
    }
    this.formationsByBuilding.set(buildingId, { buildingId, kind, team, center: center.clone(), droneIds: visibleIds, createdAt: time });
    return true;
  }

  releaseBuilding(buildingId: number, time: number): number {
    const f = this.formationsByBuilding.get(buildingId);
    if (!f) return 0;
    const cost = SYNONYMOUS_BUILD_COST[f.kind === 'laserturret' ? 'missileturret' : f.kind] ?? 0;
    this.formationsByBuilding.delete(buildingId);
    const drones = this.dronesByTeam.get(f.team) ?? [];
    for (const d of drones) {
      if (d.allocatedTo === buildingId) d.hp = 0;
    }
    this.dronesByTeam.set(f.team, drones.filter((d) => d.hp > 0 && d.allocatedTo !== buildingId));
    this.produce(f.team, cost, f.center, time);
    return cost;
  }

  update(dt: number, time: number): void {
    for (const [team, drones] of this.dronesByTeam) {
      const base = this.baseByTeam.get(team);
      for (let i = drones.length - 1; i >= 0; i--) {
        const d = drones[i];
        if (d.hp <= 0) { drones.splice(i, 1); continue; }
        const to = d.target.sub(d.pos);
        const dist = Math.max(0.001, Math.hypot(to.x, to.y));
        const speed = d.allocatedTo ? 210 : d.returning ? 190 : 125;
        const desired = to.scale(speed / dist);
        d.vel = d.vel.scale(0.84).add(desired.scale(0.16));
        d.pos = d.pos.add(d.vel.scale(dt));
        if (!d.allocatedTo && base && d.returning && d.pos.distanceTo(base) < 16) d.returning = false;
      }
      if (base) {
        const free = drones.filter((d) => !d.allocatedTo && !d.returning);
        for (let i = 0; i < free.length; i++) {
          const a = i * 2.399 + time * 0.18;
          const r = 26 + Math.sqrt(i) * SYNONYMOUS_DRONE_RADIUS * 1.8;
          const idle = base.add(new Vec2(Math.cos(a) * r, Math.sin(a) * r));
          free[i].target = free[i].target.scale(0.97).add(idle.scale(0.03));
        }
      }
    }
  }

  damageDroneAt(team: Team, pos: Vec2, amount: number): boolean {
    const drones = this.dronesByTeam.get(team);
    if (!drones) return false;
    let best: Drone | null = null;
    let bestDist = SYNONYMOUS_DRONE_RADIUS * 1.25;
    for (const d of drones) {
      if (d.allocatedTo) continue;
      const dist = d.pos.distanceTo(pos);
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    if (!best) return false;
    best.hp -= amount;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, time: number): void {
    for (const [team, drones] of this.dronesByTeam) {
      const color = teamColor(team);
      for (const f of this.formationsByBuilding.values()) {
        if (f.team === team) this.drawFormationLines(ctx, camera, f, color);
      }
      for (const d of drones) this.drawDrone(ctx, camera, d, color, time);
    }
  }

  drawBuildingOverlay(ctx: CanvasRenderingContext2D, camera: Camera, buildingId: number): boolean {
    const f = this.formationsByBuilding.get(buildingId);
    if (!f) return false;
    this.drawFormationLines(ctx, camera, f, teamColor(f.team));
    return true;
  }

  private addDrone(team: Team, pos: Vec2, time: number): void {
    const base = this.baseByTeam.get(team) ?? pos;
    const d: Drone = {
      id: this.nextDroneId++,
      pos: pos.clone(),
      vel: new Vec2(0, 0),
      target: pos.clone(),
      hp: SYNONYMOUS_DRONE_HP,
      bornAt: time,
      awakenedAt: time + base.distanceTo(pos) / 320,
    };
    const drones = this.dronesByTeam.get(team) ?? [];
    drones.push(d);
    this.dronesByTeam.set(team, drones);
  }

  private formationPoint(kind: SynonymousShapeKind, center: Vec2, i: number, n: number): Vec2 {
    const sides = kind === 'factory' ? 8 : kind === 'researchlab' ? 5 : kind === 'laserturret' ? 3 : 6;
    const ring = i % sides;
    const layer = Math.floor(i / sides);
    const a = (ring / sides) * Math.PI * 2 + layer * 0.13;
    const radius = 18 + layer * 11 + (kind === 'laserturret' ? 10 : 0);
    if (i >= n - 1) return center.clone();
    return center.add(new Vec2(Math.cos(a) * radius, Math.sin(a) * radius));
  }

  private drawDrone(ctx: CanvasRenderingContext2D, camera: Camera, d: Drone, color: Color, time: number): void {
    const s = camera.worldToScreen(d.pos);
    const r = SYNONYMOUS_DRONE_RADIUS * camera.zoom;
    const awake = Math.max(0, Math.min(1, (time - d.awakenedAt) / 0.35));
    ctx.save();
    ctx.globalAlpha = d.allocatedTo && d.hp <= 0 ? 0 : 1;
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.62);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (awake > 0) {
      const ringR = r * (1 + awake * 0.42);
      ctx.strokeStyle = colorToCSS(Colors.general_building, 0.75);
      ctx.lineWidth = Math.max(1, r * 0.28);
      ctx.beginPath();
      ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = colorToCSS(color, 0.9 * awake);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.52, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFormationLines(ctx: CanvasRenderingContext2D, camera: Camera, f: Formation, color: Color): void {
    const drones = (this.dronesByTeam.get(f.team) ?? []).filter((d) => f.droneIds.includes(d.id));
    if (drones.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = colorToCSS(color, 0.55);
    ctx.lineWidth = Math.max(1, 1.2 * camera.zoom);
    ctx.beginPath();
    const sorted = drones.slice().sort((a, b) => Math.atan2(a.pos.y - f.center.y, a.pos.x - f.center.x) - Math.atan2(b.pos.y - f.center.y, b.pos.x - f.center.x));
    for (let i = 0; i < sorted.length; i++) {
      const a = camera.worldToScreen(sorted[i].pos);
      const b = camera.worldToScreen(sorted[(i + 1) % sorted.length].pos);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (i % 3 === 0) {
        const c = camera.worldToScreen(f.center);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}
