import { Camera } from './camera.js';
import { Colors, colorToCSS } from './colors.js';
import { HP_VALUES } from './constants.js';
import { Entity, EntityType, Team } from './entities.js';
import { Vec2, clamp } from './math.js';
import { ProjectileBase } from './projectile.js';
import type { GameState } from './gamestate.js';

export const SYNONYMOUS_MINE_LAYER_RANGE = 250;
const MINE_RADIUS = 5.5;
const MINE_DAMAGE = 32;
const MINE_BLAST_RADIUS = 58;
const MINE_ARM_RADIUS = 78;
const MINE_CONTACT_RADIUS = 12;
const MINE_DRIFT_SPEED = 23;
const MINE_MAX_SPEED = 175;
const MINE_ACCEL_BASE = 28;
const MINE_ACCEL_SCALE = 360;

export class SynonymousDriftMine extends ProjectileBase {
  readonly blastRadius = MINE_BLAST_RADIUS;
  readonly home: Vec2;
  readonly maxRadius: number;
  readonly marker = 'synonymousDriftMine';
  private age = 0;

  constructor(team: Team, home: Vec2, angle: number, maxRadius: number, source: Entity | null, private readonly state: GameState) {
    super({
      type: EntityType.Missile,
      team,
      position: home,
      angle,
      damage: MINE_DAMAGE,
      speed: MINE_DRIFT_SPEED,
      lifetime: 30,
      source,
    });
    this.home = home.clone();
    this.maxRadius = maxRadius;
    this.radius = MINE_RADIUS;
    this.health = HP_VALUES.synonymousDriftMine;
    this.maxHealth = HP_VALUES.synonymousDriftMine;
    this.interceptable = true;
  }

  override update(dt: number): void {
    if (!this.alive) return;
    this.age += dt;
    const target = this.nearestEnemy();
    if (target) {
      const dx = target.position.x - this.position.x;
      const dy = target.position.y - this.position.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      if (dist <= target.radius + MINE_CONTACT_RADIUS) {
        this.destroy();
        return;
      }
      const proximity = 1 - clamp(dist / MINE_ARM_RADIUS, 0, 1);
      const accel = MINE_ACCEL_BASE + MINE_ACCEL_SCALE * proximity * proximity;
      this.velocity.x += (dx / dist) * accel * dt;
      this.velocity.y += (dy / dist) * accel * dt;
    } else {
      const distHome = Math.max(1, this.position.distanceTo(this.home));
      this.velocity.x += ((this.position.x - this.home.x) / distHome) * MINE_ACCEL_BASE * 0.18 * dt;
      this.velocity.y += ((this.position.y - this.home.y) / distHome) * MINE_ACCEL_BASE * 0.18 * dt;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > MINE_MAX_SPEED) {
      this.velocity.x = this.velocity.x / speed * MINE_MAX_SPEED;
      this.velocity.y = this.velocity.y / speed * MINE_MAX_SPEED;
    }
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.updateTrail(dt);
    if (this.position.distanceTo(this.home) >= this.maxRadius || this.lifetime - this.age <= 0) {
      this.destroy();
    }
  }

  override draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 8);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.12 + pulse * 0.12);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorToCSS(Colors.friendlyfire, 0.58);
    ctx.lineWidth = Math.max(1, 1.2 * camera.zoom);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 1.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.82);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private nearestEnemy(): Entity | null {
    let best: Entity | null = null;
    let bestDist = MINE_ARM_RADIUS;
    for (const e of this.state.allEntities()) {
      if (!e.alive || e.team === this.team || e.team === Team.Neutral) continue;
      if (e instanceof ProjectileBase) continue;
      const d = this.position.distanceTo(e.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }
}

export function isSynonymousDriftMine(entity: Entity): entity is SynonymousDriftMine {
  return entity instanceof SynonymousDriftMine;
}

