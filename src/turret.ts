/** Turret types for Gate88 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team } from './entities.js';
import { BuildingBase } from './building.js';
import { Colors, colorToCSS } from './colors.js';
import { ENTITY_RADIUS, WEAPON_STATS, DT, HP_VALUES } from './constants.js';
import type { GameState } from './gamestate.js';
import { SynonymousDriftMine, SYNONYMOUS_MINE_LAYER_RANGE } from './synonymousMine.js';
import { aimAngle, aimAtEntity, isCombatTargetValid, isFiniteVec, isHostileTeam, type PredictiveAimResult } from './targeting.js';

export const EXCITER_LOCK_TIME_SECS = 2.0;
export const EXCITER_COOLDOWN_SECS = 3.0;
export const EXCITER_DAMAGE = WEAPON_STATS.exciterbeam.damage;
const EXCITER_LOCK_CIRCLE_RADIUS = 18;

// ---------------------------------------------------------------------------
// Base turret
// ---------------------------------------------------------------------------

export abstract class TurretBase extends BuildingBase {
  targetEntity: Entity | null = null;
  commandTarget: Entity | null = null;
  fireTimer: number = 0;
  fireRate: number; // ticks between shots
  range: number;
  turretAngle: number = 0;
  beamTargetPos: Vec2 | null = null;
  beamTimer: number = 0;
  lastAim: PredictiveAimResult | null = null;

  constructor(
    type: EntityType,
    team: Team,
    position: Vec2,
    health: number,
    fireRate: number,
    range: number,
  ) {
    super(type, team, position, health, ENTITY_RADIUS.building);
    this.fireRate = fireRate;
    this.range = range;
  }

  update(dt: number): void {
    super.update(dt);
    if (!this.alive || this.buildProgress < 1) return;

    // Rotate towards target
    if (this.targetEntity && this.targetEntity.alive) {
      const aim = this.computeAim(this.targetEntity);
      const desired = aimAngle(aim);
      if (desired === null) {
        this.lastAim = null;
        this.targetEntity = null;
      } else {
        this.lastAim = aim;
      const diff = wrapAngle(desired - this.turretAngle);
      const rotSpeed = 3.0;
      if (Math.abs(diff) < rotSpeed * dt) {
        this.turretAngle = desired;
      } else {
        this.turretAngle = wrapAngle(
          this.turretAngle + Math.sign(diff) * rotSpeed * dt,
        );
      }
      }
    }

    // Tick fire timer
    if (this.fireTimer > 0) {
      this.fireTimer -= dt;
    }
    if (this.beamTimer > 0) {
      this.beamTimer -= dt;
      if (this.beamTimer <= 0) this.beamTargetPos = null;
    }
  }

  /** Check if the turret can fire at its current target. */
  canFire(): boolean {
    if (this.fireTimer > 0 || !isCombatTargetValid(this, this.targetEntity, this.range)) {
      return false;
    }
    const aim = this.computeAim(this.targetEntity);
    const angle = aimAngle(aim);
    if (angle === null || !isFiniteVec(aim.direction)) return false;
    this.lastAim = aim;
    this.turretAngle = angle;
    return true;
  }

  /** Consume a shot, resetting the fire timer. */
  consumeShot(): void {
    this.fireTimer = this.fireRate * DT;
  }

  showBeam(target: Vec2, duration: number = 0.18): void {
    this.beamTargetPos = target.clone();
    this.beamTimer = duration;
  }

  /**
   * Find and set the nearest valid target from a list of entities.
   * For most turrets this means nearest enemy; RegenTurret overrides this.
   */
  acquireTarget(entities: Entity[]): void {
    if (isCombatTargetValid(this, this.targetEntity, this.range)) return;
    let best: Entity | null = null;
    let bestDist = this.range;
    for (const e of entities) {
      if (!e.alive || !isHostileTeam(this.team, e.team)) continue;
      const d = this.position.distanceTo(e.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    this.targetEntity = best;
  }

  computeAim(target: Entity): PredictiveAimResult {
    return aimAtEntity(this, target, this.projectileSpeedForAim(), {
      maxPredictionTime: this.maxPredictionTimeForAim(),
      fallback: 'shortPrediction',
    });
  }

  projectileSpeedForAim(): number {
    switch (this.type) {
      case EntityType.GatlingTurret: return WEAPON_STATS.gatlingturret.speed;
      case EntityType.MissileTurret: return WEAPON_STATS.missile.speed;
      case EntityType.ExciterTurret: return 0;
      case EntityType.MassDriverTurret: return WEAPON_STATS.massdriverbullet.speed;
      default: return WEAPON_STATS.fire.speed;
    }
  }

  maxPredictionTimeForAim(): number {
    switch (this.type) {
      case EntityType.MissileTurret: return 0.55;
      case EntityType.MassDriverTurret: return 1.6;
      default: return 0.9;
    }
  }

  /** Common turret drawing: square platform + barrel line. */
  protected drawTurretBase(
    ctx: CanvasRenderingContext2D,
    screen: Vec2,
    r: number,
    detailColor: string,
    camera: Camera,
  ): void {
    const vis = this.drawBuildingBase(ctx, screen, detailColor, camera);

    // Barrel line
    ctx.strokeStyle = detailColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(
      screen.x + Math.cos(this.turretAngle) * vis.half * 0.9,
      screen.y + Math.sin(this.turretAngle) * vis.half * 0.9,
    );
    ctx.stroke();

  }

  protected drawBeam(ctx: CanvasRenderingContext2D, camera: Camera, screen: Vec2): void {
    if (!this.beamTargetPos || this.beamTimer <= 0) return;
    const target = camera.worldToScreen(this.beamTargetPos);
    const a = Math.min(1, this.beamTimer / 0.18);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = colorToCSS(Colors.particles_healing, 0.25 + a * 0.45);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.strokeStyle = colorToCSS(Colors.particles_switch, 0.45 + a * 0.35);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// GatlingTurret
// ---------------------------------------------------------------------------

export class GatlingTurret extends TurretBase {
  constructor(position: Vec2, team: Team) {
    super(
      EntityType.GatlingTurret,
      team,
      position,
      HP_VALUES.turret,
      WEAPON_STATS.gatlingturret.fireRate,
      WEAPON_STATS.gatlingturret.range,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detail = colorToCSS(Colors.gatlingturret_detail);
    this.drawTurretBase(ctx, screen, r, detail, camera);

    const perpX = -Math.sin(this.turretAngle) * r * 0.22;
    const perpY = Math.cos(this.turretAngle) * r * 0.22;
    const endX = Math.cos(this.turretAngle) * r * 1.05;
    const endY = Math.sin(this.turretAngle) * r * 1.05;
    ctx.strokeStyle = detail;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(screen.x + perpX, screen.y + perpY);
    ctx.lineTo(screen.x + perpX + endX, screen.y + perpY + endY);
    ctx.moveTo(screen.x - perpX, screen.y - perpY);
    ctx.lineTo(screen.x - perpX + endX, screen.y - perpY + endY);
    ctx.stroke();
    ctx.fillStyle = colorToCSS(Colors.gatlingturret_detail, 0.65);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// MissileTurret
// ---------------------------------------------------------------------------

export class MissileTurret extends TurretBase {
  constructor(position: Vec2, team: Team) {
    super(
      EntityType.MissileTurret,
      team,
      position,
      HP_VALUES.turret,
      WEAPON_STATS.missile.fireRate,
      400,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detail = colorToCSS(Colors.missileturret_detail);
    this.drawTurretBase(ctx, screen, r, detail, camera);

    // Small missile shape at barrel tip
    const tipX = screen.x + Math.cos(this.turretAngle) * r * 0.9;
    const tipY = screen.y + Math.sin(this.turretAngle) * r * 0.9;
    ctx.fillStyle = detail;
    ctx.beginPath();
    ctx.arc(tipX, tipY, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// ExciterTurret
// ---------------------------------------------------------------------------

export class ExciterTurret extends TurretBase {
  lockTarget: Entity | null = null;
  lockProgress = 0;
  cooldownRemaining = 0;
  exciterState: 'idle' | 'locking' | 'ready' | 'cooldown' = 'idle';
  lastLaserTargetPos: Vec2 | null = null;

  constructor(position: Vec2, team: Team) {
    super(
      EntityType.ExciterTurret,
      team,
      position,
      HP_VALUES.turret,
      WEAPON_STATS.exciterbeam.fireRate,
      WEAPON_STATS.exciterbeam.range,
    );
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.alive || this.buildProgress < 1) return;

    if (this.exciterState === 'cooldown') {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
      if (this.cooldownRemaining <= 0) this.exciterState = 'idle';
      return;
    }

    if (this.exciterState === 'locking') {
      if (!isCombatTargetValid(this, this.lockTarget, this.range)) {
        this.cancelLockToCooldown();
        return;
      }
      this.targetEntity = this.lockTarget;
      this.lockProgress = Math.min(1, this.lockProgress + dt / EXCITER_LOCK_TIME_SECS);
      if (this.lockTarget) {
        const desired = this.position.angleTo(this.lockTarget.position);
        const diff = wrapAngle(desired - this.turretAngle);
        this.turretAngle = wrapAngle(this.turretAngle + Math.sign(diff) * Math.min(Math.abs(diff), 4.2 * dt));
      }
      if (this.lockProgress >= 1) this.exciterState = 'ready';
    }
  }

  override acquireTarget(entities: Entity[]): void {
    if (this.exciterState !== 'idle') return;
    let best: Entity | null = null;
    let bestDist = this.range;
    for (const e of entities) {
      if (!e.alive || !isHostileTeam(this.team, e.team)) continue;
      const d = this.position.distanceTo(e.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (best) {
      this.lockTarget = best;
      this.targetEntity = best;
      this.lockProgress = 0;
      this.exciterState = 'locking';
    }
  }

  override canFire(): boolean {
    if (this.exciterState !== 'ready') return false;
    if (!isCombatTargetValid(this, this.lockTarget, this.range)) {
      this.cancelLockToCooldown();
      return false;
    }
    return true;
  }

  override consumeShot(): void {
    this.lastLaserTargetPos = this.lockTarget?.position.clone() ?? null;
    this.lockTarget = null;
    this.targetEntity = null;
    this.lockProgress = 0;
    this.cooldownRemaining = EXCITER_COOLDOWN_SECS;
    this.exciterState = 'cooldown';
  }

  cancelLockToCooldown(): void {
    this.lockTarget = null;
    this.targetEntity = null;
    this.lockProgress = 0;
    this.cooldownRemaining = EXCITER_COOLDOWN_SECS;
    this.exciterState = 'cooldown';
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detail = colorToCSS(Colors.exciterturret_detail);
    this.drawTurretBase(ctx, screen, r, detail, camera);

    const endX = Math.cos(this.turretAngle) * r * 1.12;
    const endY = Math.sin(this.turretAngle) * r * 1.12;
    ctx.strokeStyle = detail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(screen.x + endX, screen.y + endY);
    ctx.stroke();
    this.drawLockOn(ctx, camera, screen);
  }

  private drawLockOn(ctx: CanvasRenderingContext2D, camera: Camera, turretScreen: Vec2): void {
    if ((this.exciterState !== 'locking' && this.exciterState !== 'ready') || !this.lockTarget?.alive) return;
    const target = camera.worldToScreen(this.lockTarget.position);
    const progress = Math.max(0, Math.min(1, this.lockProgress));
    const circleR = EXCITER_LOCK_CIRCLE_RADIUS * camera.zoom;
    const outerGap = (42 - 26 * progress) * camera.zoom;
    const triLen = 10 * camera.zoom;
    const color = this.team === Team.Player ? Colors.friendlyfire : Colors.enemyfire;

    const dx = target.x - turretScreen.x;
    const dy = target.y - turretScreen.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const edgeX = target.x - (dx / len) * circleR;
    const edgeY = target.y - (dy / len) * circleR;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = colorToCSS(color, 0.2 + progress * 0.55);
    ctx.lineWidth = 0.8 + progress * 4.2;
    ctx.beginPath();
    ctx.moveTo(turretScreen.x, turretScreen.y);
    ctx.lineTo(edgeX, edgeY);
    ctx.stroke();

    ctx.strokeStyle = colorToCSS(Colors.exciterturret_detail, 0.62 + progress * 0.28);
    ctx.lineWidth = Math.max(1, 1.4 * camera.zoom);
    ctx.beginPath();
    ctx.arc(target.x, target.y, circleR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colorToCSS(color, 0.42 + progress * 0.42);
    const dirs = [
      { x: 0, y: -1, a: Math.PI / 2 },
      { x: 1, y: 0, a: Math.PI },
      { x: 0, y: 1, a: -Math.PI / 2 },
      { x: -1, y: 0, a: 0 },
    ];
    for (const d of dirs) {
      const tipX = target.x + d.x * (circleR + outerGap);
      const tipY = target.y + d.y * (circleR + outerGap);
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(d.a);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-triLen, -triLen * 0.55);
      ctx.lineTo(-triLen, triLen * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// MassDriverTurret
// ---------------------------------------------------------------------------

export class MassDriverTurret extends TurretBase {
  constructor(position: Vec2, team: Team) {
    super(
      EntityType.MassDriverTurret,
      team,
      position,
      HP_VALUES.turret,
      WEAPON_STATS.massdriverbullet.fireRate,
      500,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detail = colorToCSS(Colors.massdriverturret_detail);
    this.drawTurretBase(ctx, screen, r, detail, camera);

    // Thick barrel
    ctx.strokeStyle = detail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    const tipX = screen.x + Math.cos(this.turretAngle) * r * 1.2;
    const tipY = screen.y + Math.sin(this.turretAngle) * r * 1.2;
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    if (this.targetEntity && this.fireTimer <= this.fireRate * DT * 0.42) {
      const charge = 1 - Math.max(0, this.fireTimer) / Math.max(0.001, this.fireRate * DT * 0.42);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = colorToCSS(Colors.alert2, 0.18 + charge * 0.42);
      ctx.lineWidth = 1 + charge * 3;
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * (0.25 + charge * 0.65), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = colorToCSS(Colors.explosion, 0.12 + charge * 0.28);
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * (0.18 + charge * 0.32), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// RegenTurret – heals nearby friendlies instead of attacking
// ---------------------------------------------------------------------------

export class RegenTurret extends TurretBase {
  constructor(position: Vec2, team: Team) {
    super(
      EntityType.RegenTurret,
      team,
      position,
      HP_VALUES.turret,
      WEAPON_STATS.regenbullet.fireRate,
      300,
    );
  }

  /** Override: targets the nearest damaged friendly unit or building. */
  override canFire(): boolean {
    if (this.fireTimer > 0 || !this.targetEntity || !this.targetEntity.alive) return false;
    if (this.targetEntity.team !== this.team || this.targetEntity.health >= this.targetEntity.maxHealth) return false;
    if (!isFiniteVec(this.position) || !isFiniteVec(this.targetEntity.position)) return false;
    return this.position.distanceTo(this.targetEntity.position) <= this.range;
  }

  /** Override: targets the nearest damaged friendly unit or building. */
  acquireTarget(entities: Entity[]): void {
    if (
      this.commandTarget?.alive &&
      this.commandTarget.team !== Team.Neutral &&
      this.commandTarget.team !== this.team &&
      this.position.distanceTo(this.commandTarget.position) <= this.range
    ) {
      this.targetEntity = this.commandTarget;
      return;
    }
    if (this.commandTarget && (!this.commandTarget.alive || this.position.distanceTo(this.commandTarget.position) > this.range)) {
      this.commandTarget = null;
    }
    let best: Entity | null = null;
    let bestDist = this.range;
    for (const e of entities) {
      if (!e.alive || e.team !== this.team) continue;
      if (e.health >= e.maxHealth) continue;
      if (e === (this as Entity)) continue;
      const d = this.position.distanceTo(e.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    this.targetEntity = best;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detail = colorToCSS(Colors.regenturret_detail);
    this.drawTurretBase(ctx, screen, r, detail, camera);
    this.drawBeam(ctx, camera, screen);

    // Plus / cross symbol
    ctx.strokeStyle = colorToCSS(Colors.particles_healing);
    ctx.lineWidth = 2;
    const s = r * 0.35;
    ctx.beginPath();
    ctx.moveTo(screen.x - s, screen.y);
    ctx.lineTo(screen.x + s, screen.y);
    ctx.moveTo(screen.x, screen.y - s);
    ctx.lineTo(screen.x, screen.y + s);
    ctx.stroke();
  }
}

export class SynonymousMineLayer extends BuildingBase {
  private spin = 0;
  private mineTimer = 0.35;
  private mineIndex = 0;

  constructor(position: Vec2, team: Team) {
    super(EntityType.TimeBomb, team, position, HP_VALUES.turret, ENTITY_RADIUS.building);
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.alive || this.buildProgress < 1) return;
    this.spin += dt * 0.55;
    this.mineTimer -= dt;
  }

  tickMineLayer(state: GameState): void {
    if (!this.alive || this.buildProgress < 1 || this.mineTimer > 0) return;
    const liveMines = state.projectiles.filter((p) => p.alive && p.source === this && p instanceof SynonymousDriftMine).length;
    if (liveMines >= 9) {
      this.mineTimer = 0.8;
      return;
    }
    const golden = Math.PI * (3 - Math.sqrt(5));
    const angle = this.spin + this.mineIndex * golden;
    const spawn = new Vec2(
      this.position.x + Math.cos(angle) * this.radius * 1.1,
      this.position.y + Math.sin(angle) * this.radius * 1.1,
    );
    state.addEntity(new SynonymousDriftMine(this.team, this.position, angle, SYNONYMOUS_MINE_LAYER_RANGE, this, state));
    const mine = state.projectiles[state.projectiles.length - 1];
    mine.position = spawn;
    this.mineIndex++;
    this.mineTimer = 2.7;
  }

  override draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const side = this.radius * 2.6 * camera.zoom;
    const color = this.team === Team.Player ? Colors.friendlyfire : Colors.enemyfire;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = colorToCSS(color, 0.38 + this.healthFraction * 0.28);
    ctx.lineWidth = Math.max(1, 1.3 * camera.zoom);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, side * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.spin);
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI * 2 / 20;
      const pulse = 0.86 + 0.14 * Math.sin(this.spin * 2 + i * 0.9);
      const x = Math.cos(a) * side * 0.42 * pulse;
      const y = Math.sin(a) * side * 0.42 * pulse;
      ctx.fillStyle = colorToCSS(color, 0.66);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, 2.1 * camera.zoom), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, side * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

