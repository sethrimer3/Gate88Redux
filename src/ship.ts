/** Player ship implementation for Gate88 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import { ENTITY_RADIUS, PLAYER_SHIP_SCALE, SHIP_STATS, PLAYER_SPAWN_INVINCIBILITY_SECS } from './constants.js';
import { DEFAULT_SPECIAL_ID } from './special.js';

const BATTERY_MAX = 100;
const BATTERY_REGEN_RATE = 16;
const BATTERY_FIRE_COST = 5;
export const GATLING_BATTERY_FIRE_COST = BATTERY_FIRE_COST / 3;
export const GUIDED_MISSILE_INITIAL_BATTERY_COST = 14;
export const GUIDED_MISSILE_CONTROL_BATTERY_DRAIN = 8;
const SHIELD_MAX = 40;
const SHIELD_REGEN_RATE = 7;
const SHIELD_REGEN_DELAY = 2.5;
const SHIP_WEAPON_IDS = ['cannon', 'gatling', 'laser', 'guidedmissile'] as const;
export type ShipWeaponId = typeof SHIP_WEAPON_IDS[number];
export const SHIP_WEAPON_OPTIONS: ReadonlyArray<{
  id: ShipWeaponId;
  label: string;
  researchKey?: string;
  description: string;
}> = [
  { id: 'cannon', label: 'Cannon', description: 'Reliable medium-range primary weapon.' },
  { id: 'gatling', label: 'Gatling', researchKey: 'weaponGatling', description: 'Very weak, very fast, short range.' },
  { id: 'laser', label: 'Laser', researchKey: 'weaponLaser', description: 'Thin slow-firing beam with infinite pierce.' },
  { id: 'guidedmissile', label: 'Guided Missile', researchKey: 'weaponGuidedMissile', description: 'Hold fire to steer a heavy explosive missile.' },
];

/** Speed multiplier when boosting (Shift held). */
const BOOST_SPEED_MULT = 1.8;
/** Battery drained per second while boost-thrusting. */
const BOOST_BATTERY_DRAIN = 30;

/**
 * How quickly the visual ship rotation chases the mouse-aim target. Set high
 * enough that aim feels instant but not so high that fast cursor jumps cause
 * visible snaps in the trail of exhaust particles.
 */
const AIM_TURN_RATE = 18.0; // radians per second

/**
 * Cross-product magnitude of (facing × thrustDir) above which we consider the
 * thrust to be perpendicular enough to the ship's facing to count as a "strafe"
 * (which triggers the side-thruster flame visual). Sin(~17°) ≈ 0.3 means
 * thrust within ~17° of straight forward/back is *not* counted as strafing.
 */
const STRAFE_CROSS_THRESHOLD = 0.3;

export class PlayerShip extends Entity {
  turnRate: number;
  thrustPower: number;
  maxSpeed: number;
  friction: number;

  battery: number = BATTERY_MAX;
  maxBattery: number = BATTERY_MAX;
  baseBatteryRegenRate: number = BATTERY_REGEN_RATE;

  primaryFireTimer: number = 0;
  specialFireTimer: number = 0;
  primaryWeaponId: ShipWeaponId = 'cannon';
  fireCooldownMultiplier: number = 1;
  shieldUnlocked = false;
  shield: number = 0;
  maxShield: number = SHIELD_MAX;
  shieldRegenRate: number = SHIELD_REGEN_RATE;
  private shieldRegenDelay = 0;

  /** Accumulated time used for visual effects like the low-battery flash. */
  drawTime: number = 0;

  /**
   * World-space target the ship rotates toward. The game loop updates this
   * each tick from the mouse cursor (via Camera.screenToWorld). Defaults to
   * "directly to the right" so the ship has a sensible angle before any
   * mouse movement.
   */
  aimWorld: Vec2;

  /** Id of the currently equipped special ability (RMB). */
  specialAbilityId: string = DEFAULT_SPECIAL_ID;

  // ---------------------------------------------------------------------------
  // Special-ability state — managed by game.ts; held here for rendering access
  // ---------------------------------------------------------------------------

  /**
   * Spawn-invincibility countdown (seconds).  Decremented in update(); while
   * > 0 all incoming damage is blocked and a shield ring is drawn.
   */
  spawnInvincibilityTimer: number = PLAYER_SPAWN_INVINCIBILITY_SECS;

  /**
   * Gatling overdrive countdown (seconds).  While > 0 the gatling fires at
   * extreme speed; decremented and transitioned by game.ts.
   */
  gatlingOverdriveTimer: number = 0;

  /**
   * Gatling overheat lockdown countdown (seconds).  While > 0 the ship cannot
   * move; decremented and transitioned by game.ts.
   */
  gatlingOverheatTimer: number = 0;

  /** True while the laser charged-burst is accumulating charge (RMB held). */
  isLaserCharging: boolean = false;

  /** Elapsed laser charge time in seconds (clamped to LASER_MAX_CHARGE_SECS). */
  laserChargeTimer: number = 0;

  /**
   * Per-weapon special-ability cooldown (seconds).  Used by swarm missiles
   * and cannon homing; decremented in update().
   */
  weaponSpecialCooldown: number = 0;

  /**
   * Direction of last applied thrust (unit vector). Used by game.ts to emit
   * exhaust particles trailing behind the actual motion direction rather than
   * behind the ship's facing (which is now decoupled from movement).
   */
  thrustDir: Vec2 = new Vec2(0, 0);
  /** True if any movement key was held this tick (used for SFX/exhaust). */
  isThrusting: boolean = false;
  /** True when boosting (Shift held while thrusting with battery remaining). */
  isBoosting: boolean = false;

  constructor(position: Vec2, team: Team = Team.Player) {
    super(
      EntityType.PlayerShip,
      team,
      position,
      SHIP_STATS.mainguy.health,
      ENTITY_RADIUS.mainguy * (team === Team.Player ? PLAYER_SHIP_SCALE : 1),
    );
    this.turnRate = SHIP_STATS.mainguy.turnRate;
    this.thrustPower = SHIP_STATS.mainguy.speed;
    this.maxSpeed = SHIP_STATS.mainguy.speed;
    this.friction = 1.0;
    this.aimWorld = new Vec2(position.x + 100, position.y);
  }

  update(dt: number): void {
    if (!this.alive) return;

    this.handleInput(dt);

    // Apply friction (damping). No brake in the new control scheme — releasing
    // all keys naturally decelerates the ship via this friction term.
    this.velocity = this.velocity.scale(1 / (1 + this.friction * dt));

    // Clamp speed — boost allows a higher cap.
    const speed = this.velocity.length();
    const speedCap = this.isBoosting ? this.maxSpeed * BOOST_SPEED_MULT : this.maxSpeed;
    if (speed > speedCap) {
      this.velocity = this.velocity.normalize().scale(speedCap);
    }

    // Integrate position
    this.position = this.position.add(this.velocity.scale(dt));

    // Regenerate battery
    this.battery = Math.min(this.maxBattery, this.battery + this.baseBatteryRegenRate * dt);
    this.updateShield(dt);

    // Accumulate draw time for visual effects
    this.drawTime += dt;

    // Tick fire timers
    if (this.primaryFireTimer > 0) this.primaryFireTimer -= dt;
    if (this.specialFireTimer > 0) this.specialFireTimer -= dt;
    // Spawn invincibility — counts down to 0
    if (this.spawnInvincibilityTimer > 0) this.spawnInvincibilityTimer -= dt;
    // Weapon special cooldown (swarm / homing) — counts down to 0
    if (this.weaponSpecialCooldown > 0) this.weaponSpecialCooldown = Math.max(0, this.weaponSpecialCooldown - dt);
  }

  /**
   * Revive the ship at a new position after death (respawn). Preserves
   * equipped specials and any other configuration that should survive death.
   */
  revive(position: Vec2): void {
    this.position = position.clone();
    this.velocity = new Vec2(0, 0);
    this.health = this.maxHealth;
    this.alive = true;
    this.battery = this.maxBattery;
    this.shield = this.shieldUnlocked ? this.maxShield : 0;
    this.shieldRegenDelay = 0;
    this.primaryFireTimer = 0;
    this.specialFireTimer = 0;
    this.aimWorld = new Vec2(position.x + 100, position.y);
    this.thrustDir = new Vec2(0, 0);
    this.isThrusting = false;
    this.isBoosting = false;
    // Re-apply spawn invincibility on each (re)spawn
    this.spawnInvincibilityTimer = PLAYER_SPAWN_INVINCIBILITY_SECS;
    // Clear any lingering special-ability states
    this.gatlingOverdriveTimer = 0;
    this.gatlingOverheatTimer = 0;
    this.isLaserCharging = false;
    this.laserChargeTimer = 0;
    this.weaponSpecialCooldown = 0;
  }

  setAimPoint(world: Vec2): void {
    this.aimWorld = world;
  }

  protected handleInput(dt: number): void {
    // Gatling overheat: the ship is completely immobilised — only aiming works.
    if (this.gatlingOverheatTimer > 0) {
      this.isThrusting = false;
      this.isBoosting = false;
      // Still allow aim rotation so the player can plan their next move
      const desired = Math.atan2(
        this.aimWorld.y - this.position.y,
        this.aimWorld.x - this.position.x,
      );
      let delta = wrapAngle(desired - this.angle);
      const maxStep = AIM_TURN_RATE * dt;
      if (delta > maxStep) delta = maxStep;
      else if (delta < -maxStep) delta = -maxStep;
      this.angle = wrapAngle(this.angle + delta);
      return;
    }

    // --- Movement: WASD as a 4-axis direction, decoupled from facing -----
    let dx = 0;
    let dy = 0;
    if (Input.isDown('w')) dy -= 1;
    if (Input.isDown('s')) dy += 1;
    if (Input.isDown('a')) dx -= 1;
    if (Input.isDown('d')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      // Normalize so diagonals don't get a sqrt(2) speed boost.
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;

      // Shift boost: doubles thrust and speed cap, drains battery.
      const shiftHeld = Input.isDown('Shift');
      const canBoost = shiftHeld && this.battery > 0;
      const thrustMult = canBoost ? BOOST_SPEED_MULT : 1.0;

      this.velocity = this.velocity.add(
        new Vec2(ux * this.thrustPower * thrustMult * dt, uy * this.thrustPower * thrustMult * dt),
      );
      this.thrustDir = new Vec2(ux, uy);
      this.isThrusting = true;
      this.isBoosting = canBoost;

      if (canBoost) {
        this.battery = Math.max(0, this.battery - BOOST_BATTERY_DRAIN * dt);
      }
    } else {
      this.isThrusting = false;
      this.isBoosting = false;
    }

    // --- Aiming: rotate toward the world-space mouse cursor ---------------
    const desired = Math.atan2(
      this.aimWorld.y - this.position.y,
      this.aimWorld.x - this.position.x,
    );
    // Smooth turn toward desired angle so rapid cursor flicks don't snap.
    let delta = wrapAngle(desired - this.angle);
    const maxStep = AIM_TURN_RATE * dt;
    if (delta > maxStep) delta = maxStep;
    else if (delta < -maxStep) delta = -maxStep;
    this.angle = wrapAngle(this.angle + delta);
  }

  /**
   * Whether the ship is being side-thrusted. Retained for backward-compatible
   * rendering of the side thruster flames; under WASD-aim, "strafing" is any
   * thrust direction that isn't roughly aligned with the ship's facing.
   */
  get isStrafingLeft(): boolean {
    if (!this.isThrusting) return false;
    // Cross product sign of facing × thrustDir; positive = thrust is to the
    // ship's left (in screen-space where +y is down).
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    return fx * this.thrustDir.y - fy * this.thrustDir.x < -STRAFE_CROSS_THRESHOLD;
  }
  get isStrafingRight(): boolean {
    if (!this.isThrusting) return false;
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    return fx * this.thrustDir.y - fy * this.thrustDir.x > STRAFE_CROSS_THRESHOLD;
  }

  // --- Weapons ---

  canFirePrimary(): boolean {
    return this.primaryFireTimer <= 0 && this.battery >= BATTERY_FIRE_COST;
  }

  consumePrimaryFire(cooldown: number, cost: number = BATTERY_FIRE_COST): void {
    this.primaryFireTimer = cooldown;
    this.battery -= cost;
  }

  drainBattery(amount: number): boolean {
    if (amount <= 0) return true;
    if (this.battery <= 0) {
      this.battery = 0;
      return false;
    }
    this.battery = Math.max(0, this.battery - amount);
    return this.battery > 0;
  }

  canFireSpecial(): boolean {
    return this.specialFireTimer <= 0 && this.battery >= BATTERY_FIRE_COST * 2;
  }

  consumeSpecialFire(cooldown: number): void {
    this.specialFireTimer = cooldown;
    this.battery -= BATTERY_FIRE_COST * 2;
  }

  selectPrimaryWeapon(id: ShipWeaponId): void {
    if (SHIP_WEAPON_IDS.includes(id)) this.primaryWeaponId = id;
  }

  cyclePrimaryWeapon(dir: number, unlocked: (id: ShipWeaponId) => boolean): void {
    const available = SHIP_WEAPON_OPTIONS.filter((w) => unlocked(w.id)).map((w) => w.id);
    if (available.length === 0) return;
    const current = available.indexOf(this.primaryWeaponId);
    const start = current >= 0 ? current : 0;
    const next = (start + Math.sign(dir) + available.length) % available.length;
    this.primaryWeaponId = available[next];
  }

  /** False during gatling overheat — prevents bypassing lockdown by swapping weapon. */
  canSwitchWeapon(): boolean {
    return this.gatlingOverheatTimer <= 0 && this.gatlingOverdriveTimer <= 0;
  }

  applyResearchUpgrade(item: string): void {
    switch (item) {
      case 'shipHp':
        this.maxHealth = Math.round(this.maxHealth * 1.35);
        this.health = this.maxHealth;
        break;
      case 'shipSpeedEnergy':
        this.maxSpeed *= 1.14;
        this.thrustPower *= 1.12;
        this.baseBatteryRegenRate *= 1.35;
        break;
      case 'shipFireSpeed':
        this.fireCooldownMultiplier = 0.78;
        break;
      case 'shipShield':
        this.shieldUnlocked = true;
        this.shield = this.maxShield;
        this.shieldRegenDelay = 0;
        break;
      default:
        break;
    }
  }

  override takeDamage(amount: number, source?: Entity): void {
    if (!this.alive || amount <= 0) {
      super.takeDamage(amount, source);
      return;
    }
    // Spawn invincibility blocks all incoming damage during the grace period
    if (this.spawnInvincibilityTimer > 0) return;
    if (this.shieldUnlocked && this.shield > 0) {
      const blocked = Math.min(this.shield, amount);
      this.shield -= blocked;
      amount -= blocked;
      this.shieldRegenDelay = SHIELD_REGEN_DELAY;
    }
    if (amount > 0) super.takeDamage(amount, source);
  }

  private updateShield(dt: number): void {
    if (!this.shieldUnlocked || !this.alive) return;
    if (this.shieldRegenDelay > 0) {
      this.shieldRegenDelay -= dt;
      return;
    }
    this.shield = Math.min(this.maxShield, this.shield + this.shieldRegenRate * dt);
  }

  // --- Drawing ---

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);

    // Side thruster flames when strafing
    if (this.isStrafingLeft || this.isStrafingRight) {
      const side = this.isStrafingLeft ? 1 : -1; // +1 = flame on right side of ship (strafing left)
      ctx.strokeStyle = colorToCSS(Colors.particles_friendly_exhaust, 0.85);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, side * r * 0.7);
      ctx.lineTo(-r * 0.2, side * (r * 0.7 + r * 0.6));
      ctx.stroke();
      ctx.strokeStyle = colorToCSS(Colors.particles_friendly_exhaust, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r * 0.3, side * r * 0.55);
      ctx.lineTo(r * 0.3, side * (r * 0.55 + r * 0.45));
      ctx.stroke();
    }

    // Ship body: triangle / arrow shape
    const shipColor =
      this.team === Team.Player
        ? colorToCSS(Colors.mainguy)
        : colorToCSS(Colors.enemy_status);
    ctx.strokeStyle = shipColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 1.4, 0);
    ctx.lineTo(-r, -r * 0.7);
    ctx.lineTo(-r * 0.5, 0);
    ctx.lineTo(-r, r * 0.7);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();

    const coreColor = this.team === Team.Player ? Colors.mainguy : Colors.enemy_status;
    const corePulse = 0.5 + 0.5 * Math.sin(this.drawTime * 3.4);
    const coreGlint = 0.5 + 0.5 * Math.sin(this.drawTime * 6.1 + 0.8);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(coreColor, 0.10 + corePulse * 0.12);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorToCSS(coreColor, 0.22 + corePulse * 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      screen.x,
      screen.y,
      r * (0.62 + corePulse * 0.08),
      this.drawTime * 1.6,
      this.drawTime * 1.6 + Math.PI * 1.45,
    );
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = colorToCSS(coreColor, 0.72 + 0.28 * this.healthFraction);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colorToCSS(Colors.particles_switch, 0.25 + coreGlint * 0.2);
    ctx.beginPath();
    ctx.arc(screen.x - r * 0.1, screen.y - r * 0.1, r * 0.13, 0, Math.PI * 2);
    ctx.fill();

    // Battery ring — color shifts green→yellow→red; flashes when critical
    const batteryFrac = this.battery / this.maxBattery;
    if (batteryFrac > 0) {
      let ringColor: string;
      if (batteryFrac > 0.6) {
        ringColor = colorToCSS(Colors.radar_friendly_status, 0.75);
      } else if (batteryFrac > 0.3) {
        ringColor = colorToCSS(Colors.alert2, 0.85);
      } else {
        // Flash at critical level
        const flash = batteryFrac < 0.15 ? 0.5 + 0.5 * Math.sin(this.drawTime * 10) : 1;
        ringColor = colorToCSS(Colors.alert1, 0.9 * flash);
      }
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        screen.x,
        screen.y,
        r * 0.55,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * batteryFrac,
      );
      ctx.stroke();
    }

    if (this.shieldUnlocked && this.shield > 0) {
      const shieldFrac = this.shield / this.maxShield;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = colorToCSS(Colors.radar_allied_status, 0.18 + shieldFrac * 0.42);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * (1.45 + shieldFrac * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- Spawn invincibility ring -------------------------------------------
    // Pulsing cyan ring that shrinks slightly as the grace period nears expiry
    if (this.spawnInvincibilityTimer > 0) {
      const fraction = Math.max(0, this.spawnInvincibilityTimer / PLAYER_SPAWN_INVINCIBILITY_SECS);
      const pulse = 0.5 + 0.5 * Math.sin(this.drawTime * 9);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = colorToCSS(Colors.particles_spark, (0.35 + pulse * 0.3) * fraction);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * (2.1 + pulse * 0.25), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = colorToCSS(Colors.particles_spark, 0.12 * fraction);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * 1.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- Gatling overheat aura -----------------------------------------------
    // Red flickering glow while the ship is locked down
    if (this.gatlingOverheatTimer > 0) {
      const heatPulse = 0.5 + 0.5 * Math.sin(this.drawTime * 13);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = colorToCSS(Colors.alert1, 0.10 + heatPulse * 0.20);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorToCSS(Colors.alert1, 0.4 + heatPulse * 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- Gatling overdrive glow -----------------------------------------------
    // Orange/yellow aura during overdrive burst
    if (this.gatlingOverdriveTimer > 0) {
      const overdrivePulse = 0.5 + 0.5 * Math.sin(this.drawTime * 16);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = colorToCSS(Colors.alert2, 0.12 + overdrivePulse * 0.18);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorToCSS(Colors.alert2, 0.55 + overdrivePulse * 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- Laser charge buildup glow -------------------------------------------
    // Expanding green glow proportional to charge fraction
    if (this.isLaserCharging && this.laserChargeTimer > 0) {
      const chargeFrac = this.laserChargeTimer / 2.5; // normalised (max ~2.5 s)
      const pulse = 0.5 + 0.5 * Math.sin(this.drawTime * 14);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = colorToCSS(Colors.friendlyfire, (0.22 + chargeFrac * 0.5) * (0.7 + pulse * 0.3));
      ctx.lineWidth = 1.5 + chargeFrac * 4;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * (1.3 + chargeFrac * 1.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

