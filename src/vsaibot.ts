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
import { Colors, Color, colorToCSS } from './colors.js';
import { Bullet } from './projectile.js';
import { Audio } from './audio.js';
import { GameState } from './gamestate.js';
import { CommandPost, Shipyard, PowerGenerator } from './building.js';
import { TurretBase } from './turret.js';
import { VsAIConfig, effectiveApm, effectiveDifficultyScalar } from './vsaiconfig.js';
import { tryFireSpecial } from './special.js';
import type { EnemyBasePlanner } from './enemybaseplanner.js';

const VISION_RADIUS = 900;
const RETREAT_HEALTH_FRACTION = 0.35;
/** Health fraction at which the AI rallies back to aggression after retreating. */
const RALLY_HEALTH_FRACTION = 0.65;
const PRIMARY_FIRE_COOLDOWN = 0.18;

/** AI chat badge and color for the rival ship in Vs AI mode. */
export const AI_CHAT_PREFIX = 'RIVAL';
export const AI_CHAT_COLOR: Color = Colors.alert1;

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

type Goal = 'patrol' | 'harass' | 'attack' | 'retreat' | 'defend' | 'chase';

interface KnownTarget {
  entity: Entity;
  lastSeenPos: Vec2;
  lastSeenTime: number;
}

// Varied phrases for each goal — cycled to avoid repetition.
const GOAL_PHRASES: Record<Goal, string[]> = {
  patrol:  [
    'Patrolling the perimeter.',
    'Scouting the sector.',
    'Holding position.',
    'Sweeping the zone.',
  ],
  harass:  [
    "Targeting your power grid!",
    "Going after your shipyard!",
    "Disrupting your supply lines.",
    "Cutting your infrastructure!",
  ],
  attack:  [
    'Moving to attack!',
    'Engaging your position!',
    'Pressing the offensive!',
    'You cannot hide from me.',
  ],
  retreat: [
    'Hull integrity critical — falling back!',
    'Retreating to repair!',
    'Taking cover — not done yet.',
    'Tactical withdrawal in progress.',
  ],
  defend:  [
    'Intercepting threat near base!',
    'Defending command post!',
    'You will not breach our perimeter.',
    'Scrambling to defend!',
  ],
  chase:   [
    "You can't run forever!",
    'Finishing the fight!',
    'Pursuing — your ship is almost gone!',
    "I see you're damaged. Surrender.",
  ],
};

export class VsAIDirector {
  readonly config: VsAIConfig;
  readonly ship: AIShip;
  /** Action budget for APM-based throttling. */
  private actionTokens: number = 0;
  /** When the director last replanned. */
  private replanTimer: number = 0;
  /** Current high-level goal. */
  goal: Goal = 'patrol';
  /** Previous goal — used to detect goal changes for chat narration. */
  private prevGoal: Goal = 'patrol';
  /** Cached current target world position. */
  goalTarget: Vec2 | null = null;
  /** Last-seen player entities. Pruned by age. */
  private memory: Map<number, KnownTarget> = new Map();
  /** Reaction-delay timer so low-difficulty AIs are sluggish. */
  private reactionTimer: number = 0;
  /** Cycling index used to vary chat phrases within a goal. */
  private chatPhraseIndex: number = 0;
  /** Minimum time between chat messages (prevents spam). */
  private chatCooldown: number = 0;
  /**
   * Pending AI chat messages for the caller to drain each tick.
   * Each entry is a string the game should display to the player.
   */
  private pendingChats: string[] = [];
  /**
   * Strafe direction toggle timer.  Flips sign every 2 s so the AI
   * doesn't circle-strafe in a predictable fixed direction.
   */
  private strafeDirTimer: number = 0;
  /** Current strafe direction sign (+1 or -1). */
  private strafeDirSign: number = 1;
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

  /**
   * Drain and return any pending AI chat messages accumulated since the
   * last call. The caller (game.ts) forwards these to hud.showAIChat().
   */
  drainChats(): string[] {
    if (this.pendingChats.length === 0) return [];
    const msgs = this.pendingChats.slice();
    this.pendingChats = [];
    return msgs;
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

    // Decay chat cooldown.
    if (this.chatCooldown > 0) this.chatCooldown = Math.max(0, this.chatCooldown - dt);

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

    // Rally check: if we were retreating and health has recovered, go back on the offensive.
    if (this.goal === 'retreat' && this.ship.healthFraction >= RALLY_HEALTH_FRACTION) {
      this.goal = 'attack';
      this.goalTarget = this.findAttackTarget(state)?.lastSeenPos.clone() ?? null;
      this.emitChat('attack');
    }

    // Tick the reaction-delay then resolve micro behavior.
    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.driveShip(state, dt);
  }

  private replanInterval(): number {
    return interpolateDifficulty([4.0, 2.5, 1.6, 1.0, 0.18], this.config);
  }

  private spendToken(): boolean {
    if (this.actionTokens >= 1) {
      this.actionTokens -= 1;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------
  // Chat narration
  // -------------------------------------------------------------------

  private emitChat(goal: Goal): void {
    // Only chat when the goal has meaningfully changed and the cooldown expired.
    if (this.chatCooldown > 0) return;
    const phrases = GOAL_PHRASES[goal];
    const text = phrases[this.chatPhraseIndex % phrases.length];
    this.chatPhraseIndex++;
    this.pendingChats.push(text);
    // Longer cooldown on Easy (less chatty rival) to match its sluggish personality.
    this.chatCooldown = interpolateDifficulty([12, 8, 5, 4, 1.5], this.config);
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
    this.prevGoal = this.goal;

    // Retreat first if low health.
    if (this.ship.healthFraction < RETREAT_HEALTH_FRACTION) {
      this.setGoal('retreat', state);
      const cp = this.findOwnCP(state);
      this.goalTarget = cp ? cp.position.clone() : null;
      this.reactionTimer = this.reactionDelay();
      return;
    }

    // Chase when player is very low HP — pursue before they can escape.
    if (state.player.alive && state.player.healthFraction < 0.25) {
      this.setGoal('chase', state);
      this.goalTarget = state.player.position.clone();
      this.reactionTimer = this.reactionDelay() * 0.5; // faster reaction for chase
      return;
    }

    const cp = this.findOwnCP(state);
    const idx = Math.floor(effectiveDifficultyScalar(this.config));

    // 1. Defensive override — planner signals a high-priority defense point.
    //    Only on Hard+ (idx >= 2): easier difficulties use simpler reactive defense
    //    to keep the AI feeling sluggish and beatable.
    if (this.planner && idx >= 2) {
      const defPoint = this.planner.getHighestPriorityDefensePoint(state);
      if (defPoint) {
        this.setGoal('defend', state);
        this.goalTarget = defPoint;
        this.reactionTimer = this.reactionDelay();
        return;
      }
    }

    // 2. Generic CP defense — nearest player entity threatening our CP.
    if (cp) {
      const closestThreat = this.findClosestPlayerEntityNear(cp.position, 600);
      if (closestThreat) {
        this.setGoal('defend', state);
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
        // Escort outermost construction site only during active raids — this
        // way the AI ship protects vulnerable builders when fighters are
        // away raiding, rather than always shadowing construction.
        const raidTarget = this.planner.getActiveRaidTarget();
        if (raidTarget) {
          this.setGoal('patrol', state);
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
        this.setGoal('harass', state);
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
      this.setGoal('harass', state);
      this.goalTarget = harassTarget!.lastSeenPos.clone();
    } else if (attackTarget) {
      this.setGoal('attack', state);
      this.goalTarget = attackTarget.lastSeenPos.clone();
    } else {
      this.setGoal('patrol', state);
      const center = cp ? cp.position : this.ship.position;
      // On Hard+, patrol toward the weakest ring construction site if known.
      const weakSite = this.planner?.getWeakestRingSegment?.() ?? null;
      if (weakSite && idx >= 2) {
        // Patrol between CP and the weakest ring — midpoint keeps the AI
        // visible without abandoning the base.
        this.goalTarget = new Vec2(
          (center.x + weakSite.x) * 0.5,
          (center.y + weakSite.y) * 0.5,
        );
      } else {
        const angle = Math.random() * Math.PI * 2;
        const radius = 400;
        this.goalTarget = new Vec2(
          center.x + Math.cos(angle) * radius,
          center.y + Math.sin(angle) * radius,
        );
      }
    }
    this.reactionTimer = this.reactionDelay();
  }

  /**
   * Set the current goal and emit a chat message when it differs from the
   * previous one.  Identical consecutive goals are silently collapsed.
   */
  private setGoal(goal: Goal, _state: GameState): void {
    if (this.goal !== goal) {
      this.goal = goal;
      this.emitChat(goal);
    }
  }

  private reactionDelay(): number {
    return interpolateDifficulty([0.6, 0.35, 0.18, 0.08, 0.0], this.config);
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
      const routeCost = state.scoreShipRoute(this.ship.position, m.lastSeenPos, this.ship.team, this.ship.radius, Math.floor(effectiveDifficultyScalar(this.config)));
      const score = priority * 100 - routeCost;
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
      // Prefer damaged targets — weight distance by inverse health fraction.
      const healthBias = m.entity instanceof PlayerShip
        ? (1.0 - Math.max(0, m.entity.healthFraction)) * 200
        : 0;
      const routeCost = state.scoreShipRoute(this.ship.position, m.lastSeenPos, this.ship.team, this.ship.radius, Math.floor(effectiveDifficultyScalar(this.config)));
      const d = routeCost - healthBias;
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

  private driveShip(state: GameState, dt: number): void {
    // Tick the strafe direction timer and flip sign when it expires.
    this.strafeDirTimer -= dt;
    if (this.strafeDirTimer <= 0) {
      this.strafeDirSign *= -1;
      this.strafeDirTimer = 2.0; // flip direction every 2 s
    }

    if (this.reactionTimer > 0 || !this.goalTarget) {
      // While reaction delay is ticking, coast (no thrust, no aim change).
      this.ship.desiredMove.set(0, 0);
      this.ship.wantsFire = false;
      return;
    }

    const target = this.goalTarget;
    const intelligence = Math.floor(effectiveDifficultyScalar(this.config));
    const moveTarget = state.resolveShipNavigationTarget(this.ship, target, intelligence);
    const toTarget = new Vec2(moveTarget.x - this.ship.position.x,
                              moveTarget.y - this.ship.position.y);
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
    } else if (this.goal === 'chase') {
      // Full-speed pursuit, firing opportunistically.
      this.setMove(toTarget);
      this.ship.wantsFire = dist <= 380;
    } else {
      // attack / harass / defend: orbit at engagement range.
      const ENGAGE_R = 280;
      if (dist > ENGAGE_R + 80) {
        this.setMove(toTarget); // close in
      } else if (dist < ENGAGE_R - 80) {
        this.setMove(toTarget.scale(-1)); // back off
      } else {
        // Strafe perpendicular to maintain a moving target.  Alternate
        // direction every ~2 s so the AI doesn't circle predictably.
        const perp = new Vec2(-toTarget.y * this.strafeDirSign, toTarget.x * this.strafeDirSign);
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
        this.ship.angle, this.ship, state.player.alive ? state.player : null));
      Audio.playSoundAt('fire', playerDist);
    }

    // Special ability — used sparingly when an obvious cluster of player
    // assets is in range.  On Hard+ the special fires without spending a
    // token so it isn't bottlenecked by APM; it already has its own
    // internal cooldown (tryFireSpecial guards this).
    const idx = Math.floor(effectiveDifficultyScalar(this.config));
    if (idx >= 2 && this.ship.canFireSpecial()) {
      // Aim special at the goal target.
      tryFireSpecial(state, this.ship, target.clone());
    } else if (idx < 2 && this.ship.canFireSpecial() && this.spendToken()) {
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

function interpolateDifficulty(values: number[], cfg: VsAIConfig): number {
  const scalar = effectiveDifficultyScalar(cfg);
  const lo = Math.max(0, Math.min(values.length - 1, Math.floor(scalar)));
  const hi = Math.max(0, Math.min(values.length - 1, Math.ceil(scalar)));
  const t = scalar - lo;
  return values[lo] + (values[hi] - values[lo]) * t;
}

