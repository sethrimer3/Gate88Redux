/**
 * Vs. AI bot-player main ship + strategic controller.
 *
 * Architecture:
 *   • {@link AIShip} extends PlayerShip so it inherits the same physics,
 *     battery, and rendering. It exposes `desiredMove` (unit-vector intent)
 *     and `desiredAim` (world point) which the director sets.
 *   • {@link VsAIDirector} runs at a difficulty-scaled cadence and decides
 *     what the ship should do this beat: patrol, harass an exposed
 *     conduit, attack the nearest player asset, or retreat to its CP.
 *
 * Vision model (cheap, deterministic):
 *   • If `cheatFullMapKnowledge` is set, the AI sees everything.
 *   • Otherwise, only player entities within `visionRadius` of any
 *     friendly unit, building, or the AI ship are considered "known".
 *     We also remember last-seen positions for a short window so the AI
 *     can return to a target after losing sight of it.
 *
 * APM ticker:
 *   • Each high-level action (issue order, change target, fire special)
 *     consumes one of N action-budget tokens that refill at the
 *     configured APM rate. This is what prevents Nightmare from being
 *     instant-perfect.
 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { PlayerShip } from './ship.js';
import { Team, Entity } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import { Bullet } from './projectile.js';
import { Audio } from './audio.js';
import { GameState } from './gamestate.js';
import { CommandPost, Shipyard, PowerGenerator } from './building.js';
import { TurretBase } from './turret.js';
import { VsAIConfig, effectiveApm } from './vsaiconfig.js';
import { difficultyIndex } from './practiceconfig.js';
import { tryFireSpecial } from './special.js';
import type { EnemyBasePlanner } from './enemybaseplanner.js';

const VISION_RADIUS = 900;
const RETREAT_HEALTH_FRACTION = 0.35;
const PRIMARY_FIRE_COOLDOWN = 0.18;

/**
 * AI-controlled main ship. Lives in the same container as `state.player`
 * by being added to a parallel slot on GameState (see
 * `state.aiPlayerShip`). It is *not* added to fighter list.
 */
export class AIShip extends PlayerShip {
  /** Unit vector the director wants the ship to thrust along. (0,0) = idle. */
  desiredMove: Vec2 = new Vec2(0, 0);
  /** World point to aim at. */
  desiredAim: Vec2 = new Vec2(0, 0);
  /** When true, the ship attempts to fire its primary each tick. */
  wantsFire: boolean = false;

  constructor(position: Vec2, team: Team = Team.Enemy) {
    super(position, team);
    // Slightly tougher than the human player so a human can't trivially
    // alpha-strike the AI from full health.
    this.maxHealth = Math.floor(this.maxHealth * 1.15);
    this.health = this.maxHealth;
  }

  /** Replace the keyboard-driven input loop with director-driven intent. */
  protected override handleInput(dt: number): void {
    // Movement
    const m = this.desiredMove;
    const len = m.length();
    if (len > 0.01) {
      const ux = m.x / len;
      const uy = m.y / len;
      this.velocity = this.velocity.add(
        new Vec2(ux * this.thrustPower * dt, uy * this.thrustPower * dt),
      );
      this.thrustDir = new Vec2(ux, uy);
      this.isThrusting = true;
    } else {
      this.isThrusting = false;
    }

    // Aim
    const desired = Math.atan2(
      this.desiredAim.y - this.position.y,
      this.desiredAim.x - this.position.x,
    );
    let delta = wrapAngle(desired - this.angle);
    const maxStep = this.turnRate * dt;
    if (delta > maxStep) delta = maxStep;
    else if (delta < -maxStep) delta = -maxStep;
    this.angle = wrapAngle(this.angle + delta);
  }

  /** Distinct silhouette / colour treatment for the rival main ship. */
  override draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    super.draw(ctx, camera);
    if (!this.alive) return;
    // Add a "rival ring" — a dashed outer halo so the AI ship reads as
    // a unique entity rather than just another enemy fighter.
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    ctx.save();
    ctx.strokeStyle = colorToCSS(Colors.alert1, 0.55);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Vs. AI director
// ---------------------------------------------------------------------------

type Goal = 'patrol' | 'harass' | 'attack' | 'retreat' | 'defend';

interface KnownTarget {
  entity: Entity;
  lastSeenPos: Vec2;
  lastSeenTime: number;
}

export class VsAIDirector {
  readonly config: VsAIConfig;
  readonly ship: AIShip;
  /** Action budget for APM-based throttling. */
  private actionTokens: number = 0;
  /** When the director last replanned. */
  private replanTimer: number = 0;
  /** Current high-level goal. */
  goal: Goal = 'patrol';
  /** Cached current target world position. */
  goalTarget: Vec2 | null = null;
  /** Last-seen player entities. Pruned by age. */
  private memory: Map<number, KnownTarget> = new Map();
  /** Reaction-delay timer so low-difficulty AIs are sluggish. */
  private reactionTimer: number = 0;
  /**
   * Optional reference to the base planner for coordination.
   * When set, the director can escort construction sites, defend damaged
   * rings, and harass the player's most valuable asset.
   */
  planner: EnemyBasePlanner | null = null;

  constructor(ship: AIShip, config: VsAIConfig) {
    this.ship = ship;
    this.config = config;
  }

  // -------------------------------------------------------------------
  // Per-tick update
  // -------------------------------------------------------------------

  update(state: GameState, dt: number): void {
    if (!this.ship.alive) return;

    // Refill APM tokens (cap at 1 second worth so they don't accumulate forever).
    const apm = effectiveApm(this.config);
    const tokensPerSec = apm / 60.0;
    this.actionTokens = Math.min(tokensPerSec, this.actionTokens + tokensPerSec * dt);

    // Update vision memory.
    this.refreshVision(state);

    // Periodically rethink the high-level goal. The interval shrinks with difficulty.
    this.replanTimer -= dt;
    if (this.replanTimer <= 0) {
      this.replanTimer = this.replanInterval();
      if (this.spendToken()) {
        this.replan(state);
      }
    }

    // Tick the reaction-delay then resolve micro behavior.
    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.driveShip(state);
  }

  private replanInterval(): number {
    // Easy: 4s, Normal: 2.5s, Hard: 1.6s, Expert: 1.0s, Nightmare: 0.6s
    const idx = difficultyIndex(this.config.difficulty);
    return [4.0, 2.5, 1.6, 1.0, 0.6][idx];
  }

  private spendToken(): boolean {
    if (this.actionTokens >= 1) {
      this.actionTokens -= 1;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------
  // Vision
  // -------------------------------------------------------------------

  private refreshVision(state: GameState): void {
    const fullKnowledge = this.config.cheatFullMapKnowledge;
    // Drop stale memories (older than 30s) regardless.
    const STALE_AFTER = 30;
    for (const [id, info] of this.memory) {
      if (state.gameTime - info.lastSeenTime > STALE_AFTER) {
        this.memory.delete(id);
      }
    }
    if (fullKnowledge) {
      // Remember every player entity instantly.
      this.observe(state.player, state.gameTime);
      for (const b of state.buildings) {
        if (b.alive && b.team === Team.Player) this.observe(b, state.gameTime);
      }
      for (const f of state.fighters) {
        if (f.alive && f.team === Team.Player) this.observe(f, state.gameTime);
      }
      return;
    }
    // Limited vision: union of vision discs around AI ship + each enemy unit/building.
    const observers: Vec2[] = [this.ship.position];
    for (const b of state.buildings) {
      if (b.alive && b.team === Team.Enemy) observers.push(b.position);
    }
    for (const f of state.fighters) {
      if (f.alive && f.team === Team.Enemy) observers.push(f.position);
    }

    const visible = (p: Vec2): boolean => {
      for (const o of observers) {
        if (o.distanceTo(p) <= VISION_RADIUS) return true;
      }
      return false;
    };

    if (state.player.alive && visible(state.player.position)) {
      this.observe(state.player, state.gameTime);
    }
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      if (visible(b.position)) this.observe(b, state.gameTime);
    }
    for (const f of state.fighters) {
      if (!f.alive || f.team !== Team.Player) continue;
      if (visible(f.position)) this.observe(f, state.gameTime);
    }
  }

  private observe(e: Entity, time: number): void {
    this.memory.set(e.id, {
      entity: e,
      lastSeenPos: e.position.clone(),
      lastSeenTime: time,
    });
  }

  // -------------------------------------------------------------------
  // Strategic replan
  // -------------------------------------------------------------------

  private replan(state: GameState): void {
    // Retreat first if low health.
    if (this.ship.healthFraction < RETREAT_HEALTH_FRACTION) {
      this.goal = 'retreat';
      const cp = this.findOwnCP(state);
      this.goalTarget = cp ? cp.position.clone() : null;
      this.reactionTimer = this.reactionDelay();
      return;
    }

    const cp = this.findOwnCP(state);
    const idx = difficultyIndex(this.config.difficulty);

    // 1. Defensive override — planner signals a high-priority defense point.
    if (this.planner && idx >= 2) {
      const defPoint = this.planner.getHighestPriorityDefensePoint(state);
      if (defPoint) {
        this.goal = 'defend';
        this.goalTarget = defPoint;
        this.reactionTimer = this.reactionDelay();
        return;
      }
    }

    // 2. Generic CP defense — nearest player entity threatening our CP.
    if (cp) {
      const closestThreat = this.findClosestPlayerEntityNear(cp.position, 600);
      if (closestThreat) {
        this.goal = 'defend';
        this.goalTarget = closestThreat.position.clone();
        this.reactionTimer = this.reactionDelay();
        return;
      }
    }

    // 3. Escort active construction sites (Hard+).
    if (this.planner && idx >= 2) {
      const sites = this.planner.getActiveConstructionSites();
      if (sites.length > 0) {
        // Pick the outermost construction site (furthest from CP) to escort.
        const cpPos = cp ? cp.position : this.ship.position;
        let farthest = sites[0];
        let farthestDist = farthest.distanceTo(cpPos);
        for (const s of sites) {
          const d = s.distanceTo(cpPos);
          if (d > farthestDist) { farthestDist = d; farthest = s; }
        }
        // Only escort if there's an active raid; otherwise keep harassing.
        const raidTarget = this.planner.getActiveRaidTarget();
        if (raidTarget) {
          this.goal = 'patrol';
          this.goalTarget = farthest;
          this.reactionTimer = this.reactionDelay();
          return;
        }
      }
    }

    // 4. Use planner's suggested harass target on higher difficulty.
    if (this.planner && idx >= 2) {
      const harassPos = this.planner.getSuggestedHarassTarget(state);
      if (harassPos) {
        this.goal = 'harass';
        this.goalTarget = harassPos;
        this.reactionTimer = this.reactionDelay();
        return;
      }
    }

    // 5. Standard harass / attack logic.
    const harassTarget = this.findHarassTarget(state);
    const attackTarget = this.findAttackTarget(state);
    const preferHarass = idx >= 2 && harassTarget;

    if (preferHarass) {
      this.goal = 'harass';
      this.goalTarget = harassTarget!.lastSeenPos.clone();
    } else if (attackTarget) {
      this.goal = 'attack';
      this.goalTarget = attackTarget.lastSeenPos.clone();
    } else {
      this.goal = 'patrol';
      const center = cp ? cp.position : this.ship.position;
      const angle = Math.random() * Math.PI * 2;
      const radius = 400;
      this.goalTarget = new Vec2(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius,
      );
    }
    this.reactionTimer = this.reactionDelay();
  }

  private reactionDelay(): number {
    // Easy 0.6s, Normal 0.35, Hard 0.18, Expert 0.08, Nightmare 0.0
    const idx = difficultyIndex(this.config.difficulty);
    return [0.6, 0.35, 0.18, 0.08, 0.0][idx];
  }

  private findOwnCP(state: GameState): CommandPost | null {
    for (const b of state.buildings) {
      if (b.alive && b.team === Team.Enemy && b instanceof CommandPost) {
        return b;
      }
    }
    return null;
  }

  /** Soft "harass" target: an exposed player generator or shipyard. */
  private findHarassTarget(state: GameState): KnownTarget | null {
    let best: KnownTarget | null = null;
    let bestScore = -Infinity;
    for (const m of this.memory.values()) {
      const e = m.entity;
      if (!e.alive || e.team !== Team.Player) continue;
      let priority = 0;
      if (e instanceof PowerGenerator) priority = 5;
      else if (e instanceof Shipyard) priority = 4;
      else if (e instanceof TurretBase) priority = -2; // avoid hard targets
      else if (e instanceof CommandPost) priority = 2;
      if (priority <= 0) continue;
      const dist = this.ship.position.distanceTo(m.lastSeenPos);
      const score = priority * 100 - dist;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  /** Generic attack target: the nearest known player asset. */
  private findAttackTarget(state: GameState): KnownTarget | null {
    let best: KnownTarget | null = null;
    let bestDist = Infinity;
    for (const m of this.memory.values()) {
      if (!m.entity.alive || m.entity.team !== Team.Player) continue;
      const d = this.ship.position.distanceTo(m.lastSeenPos);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    return best;
  }

  private findClosestPlayerEntityNear(pos: Vec2, radius: number): Entity | null {
    let best: Entity | null = null;
    let bestDist = radius;
    for (const m of this.memory.values()) {
      if (!m.entity.alive || m.entity.team !== Team.Player) continue;
      const d = m.lastSeenPos.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = m.entity;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------
  // Ship micro
  // -------------------------------------------------------------------

  private driveShip(state: GameState): void {
    if (this.reactionTimer > 0 || !this.goalTarget) {
      // While reaction delay is ticking, coast (no thrust, no aim change).
      this.ship.desiredMove.set(0, 0);
      this.ship.wantsFire = false;
      return;
    }

    const target = this.goalTarget;
    const toTarget = new Vec2(target.x - this.ship.position.x,
                              target.y - this.ship.position.y);
    const dist = toTarget.length();

    // Aim
    this.ship.desiredAim = target.clone();

    // Move strategy depends on goal.
    if (this.goal === 'retreat') {
      // Move toward the goal and don't fire.
      this.setMove(toTarget);
      this.ship.wantsFire = false;
    } else if (this.goal === 'patrol') {
      // Mosey toward the patrol point at half thrust.
      this.setMove(toTarget, 0.5);
      this.ship.wantsFire = false;
    } else {
      // attack / harass / defend: orbit at engagement range.
      const ENGAGE_R = 280;
      if (dist > ENGAGE_R + 80) {
        this.setMove(toTarget); // close in
      } else if (dist < ENGAGE_R - 80) {
        this.setMove(toTarget.scale(-1)); // back off
      } else {
        // Strafe perpendicular to keep a moving target.
        const perp = new Vec2(-toTarget.y, toTarget.x);
        this.setMove(perp, 0.7);
      }
      this.ship.wantsFire = dist <= ENGAGE_R + 100;
    }

    // Resolve actual fire.
    if (this.ship.wantsFire && this.ship.canFirePrimary()) {
      this.ship.consumePrimaryFire(PRIMARY_FIRE_COOLDOWN);
      const playerDist = state.player.alive
        ? state.player.position.distanceTo(this.ship.position)
        : 9999;
      state.addEntity(new Bullet(this.ship.team, this.ship.position.clone(),
        this.ship.angle, this.ship));
      Audio.playSoundAt('fire', playerDist);
    }

    // Special ability — used sparingly when an obvious cluster of player
    // assets is in range. Costs an action token.
    const idx = difficultyIndex(this.config.difficulty);
    if (idx >= 2 && this.ship.canFireSpecial() && this.spendToken()) {
      // Aim special at the goal target.
      tryFireSpecial(state, this.ship, target.clone());
    }
  }

  /** Set ship's desired move vector. `scale` 0..1 reduces effective magnitude. */
  private setMove(v: Vec2, scale: number = 1.0): void {
    const len = v.length();
    if (len < 1e-3) {
      this.ship.desiredMove.set(0, 0);
      return;
    }
    this.ship.desiredMove = new Vec2((v.x / len) * scale, (v.y / len) * scale);
  }
}

