/** Main game coordinator for Gate88 */

import { Vec2, randomRange } from './math.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Camera } from './camera.js';
import { GameState } from './gamestate.js';
import { Starfield } from './starfield.js';
import { Nebula } from './nebula.js';
import { drawEdgeIndicators, drawRadarOverlay } from './radar.js';
import { ActionMenu, MenuResult } from './actionmenu.js';
import { HUD } from './hud.js';
import { MainMenu, MenuAction } from './menu.js';
import { Colors, colorToCSS } from './colors.js';
import { Team, EntityType, ShipGroup, Entity } from './entities.js';
import { DT, WORLD_WIDTH, WORLD_HEIGHT, RESEARCH_COST, RESEARCH_TIME, TICK_RATE, WEAPON_STATS, ACTIVE_RESEARCH_ITEMS, SHIP_STATS } from './constants.js';
import { GATLING_OVERDRIVE_DURATION_SECS, GATLING_OVERHEAT_DURATION_SECS, GATLING_OVERDRIVE_FIRE_RATE_DIVISOR } from './constants.js';
import { LASER_MAX_CHARGE_SECS, LASER_CHARGE_COOLDOWN_SECS, LASER_BURST_BASE_MULTIPLIER, LASER_BURST_ENERGY_SCALING } from './constants.js';
import { ROCKET_SWARM_COUNT, ROCKET_SWARM_SPREAD_DEGREES, ROCKET_SWARM_ENERGY_COST, ROCKET_SWARM_COOLDOWN_SECS } from './constants.js';
import { CANNON_HOMING_ENERGY_COST, CANNON_HOMING_COOLDOWN_SECS } from './constants.js';
import { BuildingBase, CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { TurretBase } from './turret.js';
import { FighterShip, BomberShip, SynonymousFighterShip, SynonymousNovaBomberShip } from './fighter.js';
import { Bullet, GatlingBullet, Laser, SynonymousDroneLaser } from './projectile.js';
import { GuidedMissile, BomberMissile, HomingBullet, SwarmMissile, ChargedLaserBurst, SynonymousNovaBomb } from './projectile.js';
import { PracticeMode } from './practicemode.js';
import { cloneDefaultPracticeConfig } from './practiceconfig.js';
import { TutorialMode } from './tutorial.js';
import { AIShip, VsAIDirector } from './vsaibot.js';
import { tryFireSpecial } from './special.js';
import { GATLING_BATTERY_FIRE_COST, GUIDED_MISSILE_CONTROL_BATTERY_DRAIN, GUIDED_MISSILE_INITIAL_BATTERY_COST } from './ship.js';
import { createBuildingFromDef, getBuildDef, buildDefForEntityType } from './builddefs.js';
import { worldToCell, footprintCenter, GRID_CELL_SIZE } from './grid.js';
import { footprintForBuildingType } from './buildingfootprint.js';
import { gameFont } from './fonts.js';
import { createSpaceFluid, SpaceFluid } from './spacefluid.js';
import type { LanClient } from './lan/lanClient.js';
import type { MsgMatchStart, MsgRelayedInput, SerializedShip, SerializedBuilding, SerializedFighter, SerializedProjectile, SerializedTerritoryCircle } from './lan/protocol.js';
import { PlayerShip } from './ship.js';
import { teamForSlot } from './teamutils.js';
import { isConfluenceFaction, isSynonymousFaction, resolveRaceSelection, type FactionType, CONFLUENCE_PLACEMENT_DISTANCE, CONFLUENCE_PLACEMENT_TOLERANCE, CONFLUENCE_BASE_RADIUS } from './confluence.js';
import { SYNONYMOUS_BUILD_COST, SYNONYMOUS_CURRENCY_SYMBOL } from './synonymous.js';
import { cloneDefaultVsAIConfig } from './vsaiconfig.js';
import { GlowLayer } from './glowlayer.js';
import { DEFAULT_VISUAL_QUALITY, VISUAL_QUALITY_PRESETS, type VisualQuality, type VisualQualityPreset } from './visualquality.js';
import { drawConfluenceTerritory, drawDebugOverlay, drawWaypointMarkers, type ShipCommandGroup, type WaypointMarker } from './gameRender.js';
import type { NetInputSnapshot, NetGameSnapshot } from './net/protocol.js';
import type { WebRtcTransport } from './online/webrtcTransport.js';

type GamePhase = 'menu' | 'playing' | 'paused';

const PLAYER_FIRE_COOLDOWN = WEAPON_STATS.fire.fireRate * DT;

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private camera: Camera;
  private state: GameState;
  private starfield: Starfield;
  private nebula: Nebula;
  private actionMenu: ActionMenu;
  private hud: HUD;
  private mainMenu: MainMenu;

  private practiceMode: PracticeMode;
  private tutorialMode: TutorialMode;
  /** Director for the Vs. AI mode — null in any other mode. */
  private vsAIDirector: VsAIDirector | null = null;

  private phase: GamePhase = 'menu';
  private lastTimestamp: number = 0;
  private accumulator: number = 0;
  private running: boolean = false;
  private debugOverlay = false;
  private lastFrameMs = 0;
  private waypointMarkers = new Map<ShipCommandGroup, WaypointMarker>();
  private activeGuidedMissile: GuidedMissile | null = null;
  private spaceFluid: SpaceFluid;
  private glowLayer: GlowLayer;
  private visualQuality: VisualQuality = DEFAULT_VISUAL_QUALITY;
  private visualPreset: VisualQualityPreset = VISUAL_QUALITY_PRESETS[DEFAULT_VISUAL_QUALITY];
  private vignetteGradient: CanvasGradient | null = null;
  private scanlinePattern: CanvasPattern | null = null;
  private fringeGradientL: CanvasGradient | null = null;
  private fringeGradientR: CanvasGradient | null = null;
  private flashGradient: CanvasGradient | null = null;
  private overlayW = 0;
  private overlayH = 0;
  /** Counts down after the player takes damage; drives the red-edge damage flash. */
  private damageFlashTimer: number = 0;
  /** Player health at the end of the last fixed tick (used to detect damage events). */
  private playerPrevHealth: number = -1;
  /** Accumulated game time used for territory pulse animations. */
  private territoryPulseTime: number = 0;

  /** Respawn timer: counts down after the player ship dies. */
  private playerRespawnTimer: number = 0;
  /** True once the death has been registered so we don't re-trigger. */
  private playerDeathHandled: boolean = false;
  /** Delay (seconds) before the player ship respawns. */
  private static readonly RESPAWN_DELAY = 3;

  // LAN multiplayer
  private lanClient: LanClient | null = null;
  /** Active online (WebRTC) transport, set when an online match is running. */
  private onlineTransport: WebRtcTransport | null = null;
  /** Slot assigned to this client (0 = host). */
  private lanMySlot: number = 0;
  /** Snapshot sequence counter for outgoing snapshots. */
  private lanSnapshotSeq: number = 0;
  /** Countdown until next snapshot broadcast (host only). */
  private lanSnapshotTimer: number = 0;
  /** Interval (seconds) between host snapshots. */
  private static readonly SNAPSHOT_INTERVAL = 1 / 20; // 20 Hz
  /** Per-slot remote input buffer (filled by relayed_input from server). */
  private lanRemoteInputs: Map<number, { dx: number; dy: number; aimX: number; aimY: number; firePrimary: boolean; fireSpecial: boolean; boost: boolean }> = new Map();
  /** Input sequence counter for outgoing input snapshots. */
  private lanInputSeq: number = 0;
  /**
   * AI directors for LAN AI slots (host-only).
   * Each entry drives one AIShip for a configured AI lobby slot.
   */
  private lanAiDirectors: VsAIDirector[] = [];
  /** Last received snapshot seq (client-only, for debug). */
  private lanLastSnapshotSeq: number = -1;
  /**
   * Client-side prediction correction vector.
   * When the host authoritative position for our ship differs from our local
   * prediction, this offset is added to the ship position and decayed to zero
   * over LAN_PREDICTION_BLEND_SECS seconds for smooth visual correction.
   */
  private lanPredictionOffset: { x: number; y: number } = { x: 0, y: 0 };
  /** Remaining fraction of prediction correction offset still to be blended out. */
  private lanPredictionOffsetAlpha: number = 0;
  /**
   * Distance threshold (world units) above which the local ship position is
   * snapped immediately to host state rather than being blended smoothly.
   */
  private static readonly LAN_PREDICTION_SNAP_THRESHOLD = 300;
  /** Duration (seconds) over which prediction corrections are blended out. */
  private static readonly LAN_PREDICTION_BLEND_SECS = 0.25;
  /**
   * Minimum error magnitude (world units) required to start accumulating a
   * prediction correction offset.  Errors smaller than this are ignored to
   * avoid micro-corrections from floating-point drift.
   */
  private static readonly LAN_PREDICTION_MIN_BLEND_THRESHOLD = 4;
  /**
   * How much of the new prediction error is added to the running blend offset
   * each time a snapshot arrives.  Higher = converges faster but may look
   * less smooth.
   */
  private static readonly LAN_PREDICTION_ALPHA_INCREMENT = 0.4;
  /**
   * Fraction of velocity difference applied per snapshot to nudge the local
   * ship's velocity toward the host-authoritative value.
   */
  private static readonly LAN_PREDICTION_VELOCITY_BLEND = 0.15;
  /**
   * Fraction of projectile position error blended per snapshot update.
   * 0.5 = half the error corrected each update (50 ms at 20 Hz).
   */
  private static readonly LAN_PROJECTILE_POSITION_BLEND = 0.5;
  /**
   * Maximum number of unacknowledged input frames kept for prediction replay.
   * At 60 Hz, 120 frames = 2 seconds of history (generous for any realistic ping).
   */
  private static readonly LAN_INPUT_RING_MAX = 120;

  /**
   * Ring buffer of local inputs not yet acknowledged by the host (client-only).
   * Each entry mirrors the fields sent in MsgInputSnapshot plus seq.
   * On snapshot arrival the host's lastProcessedInputSeqBySlot is used to
   * prune acknowledged entries, then remaining inputs are replayed on top of
   * the corrected authoritative ship state.
   */
  private lanUnacknowledgedInputs: Array<{
    seq: number; dx: number; dy: number;
    aimX: number; aimY: number; boost: boolean;
  }> = [];

  /**
   * Host-side: tracks the latest input seq acknowledged per slot.
   * Used to populate lastProcessedInputSeqBySlot in the outgoing snapshot.
   */
  private lanLastProcessedSeqPerSlot: Map<number, number> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    this.camera = new Camera();
    this.state = new GameState();
    this.starfield = new Starfield();
    this.nebula = new Nebula();
    this.actionMenu = new ActionMenu();
    this.hud = new HUD();
    this.mainMenu = new MainMenu();
    this.practiceMode = new PracticeMode();
    this.tutorialMode = new TutorialMode();

    this.spaceFluid = createSpaceFluid();
    this.glowLayer = new GlowLayer();
    this.spaceFluid.resize(window.innerWidth, window.innerHeight);
    this.applyVisualQuality(this.visualQuality);

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setScreenSize(window.innerWidth, window.innerHeight);
    this.spaceFluid.resize(window.innerWidth, window.innerHeight);
    this.glowLayer.resize(window.innerWidth, window.innerHeight);
    this.vignetteGradient = null;
    this.scanlinePattern = null;
    this.fringeGradientL = null;
    this.fringeGradientR = null;
    this.flashGradient = null;
  }

  private applyVisualQuality(quality: VisualQuality): void {
    this.visualQuality = quality;
    this.visualPreset = VISUAL_QUALITY_PRESETS[quality];
    this.spaceFluid.setLowGraphicsMode(this.visualPreset.fluidLowGraphics);
    this.glowLayer.configure(this.visualPreset.glowEnabled, this.visualPreset.glowScale);
    this.state?.ringEffects.setMaxLive(quality === 'low' ? 32 : quality === 'medium' ? 64 : 96);
  }

  private get screenW(): number {
    return window.innerWidth;
  }

  private get screenH(): number {
    return window.innerHeight;
  }

  /** Start the game loop. */
  start(): void {
    this.running = true;
    this.lastTimestamp = performance.now();
    this.mainMenu.openTitle();
    Audio.playMenuMusic();
    Audio.loadSounds();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(timestamp: number): void {
    if (!this.running) return;

    const rawDt = (timestamp - this.lastTimestamp) / 1000;
    // Clamp to avoid spiral of death on tab-away
    const frameDt = Math.min(rawDt, 0.25);
    this.lastFrameMs = frameDt * 1000;
    this.lastTimestamp = timestamp;

    this.accumulator += frameDt;

    // Fixed-timestep update at 60 Hz.
    // Input.update() is called after each fixed tick so that per-frame events
    // (wasPressed, doubleTapped, etc.) are never dropped at high frame rates
    // and are never processed more than once.
    while (this.accumulator >= DT) {
      this.fixedUpdate();
      Input.update();
      this.accumulator -= DT;
    }

    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  // -----------------------------------------------------------------------
  // Fixed-timestep update (60 Hz)
  // -----------------------------------------------------------------------

  private fixedUpdate(): void {
    switch (this.phase) {
      case 'menu':
        this.updateMenu();
        break;
      case 'playing':
        this.updatePlaying();
        break;
      case 'paused':
        this.updatePaused();
        break;
    }
  }

  private updateMenu(): void {
    // Forward typed characters to the join screen text fields.
    if (Input.typedChars) {
      for (const ch of Input.typedChars) {
        this.mainMenu.appendJoinChar(ch);
      }
    }
    const action = this.mainMenu.update(DT, this.screenW, this.screenH);
    this.handleMenuAction(action);
  }

  private updatePaused(): void {
    const action = this.mainMenu.update(DT, this.screenW, this.screenH);
    this.handleMenuAction(action);
  }

  private handleMenuAction(action: MenuAction): void {
    switch (action) {
      case 'tutorial':
        this.startGame('tutorial');
        break;
      case 'start_practice':
        this.startGame('practice');
        break;
      case 'start_vs_ai':
        this.startGame('vs_ai');
        break;
      case 'start_lan_host':
      case 'start_lan_client': {
        const matchStart = this.mainMenu.takePendingLanMatchStart();
        if (matchStart) {
          this.startLanGame(matchStart, action === 'start_lan_host');
        }
        break;
      }
      case 'start_online_host':
      case 'start_online_client': {
        const pending = this.mainMenu.takePendingOnlineMatchStart();
        if (pending) {
          this.startOnlineGame(pending.transport, pending.matchStart, action === 'start_online_host');
        }
        break;
      }
      case 'resume':
        this.phase = 'playing';
        this.mainMenu.close();
        break;
      case 'quit_to_menu':
        this.phase = 'menu';
        this.mainMenu.openTitle();
        Audio.stopDriveLoop();
        Audio.stopMusic();
        Audio.playMenuMusic();
        if (this.lanClient) {
          this.lanClient.disconnect();
          this.lanClient = null;
        }
        break;
      default:
        break;
    }
  }

  private updatePlaying(): void {
    // ESC -> pause
    if (Input.wasPressed('F6')) {
      const next: Record<VisualQuality, VisualQuality> = { low: 'medium', medium: 'high', high: 'low' };
      this.applyVisualQuality(next[this.visualQuality]);
      this.hud.showMessage(`Visual quality: ${this.visualQuality.toUpperCase()}`, Colors.general_building, 2);
    }
    if (Input.wasPressed('Escape') && !this.actionMenu.open && !this.actionMenu.placementMode) {
      this.phase = 'paused';
      this.mainMenu.openPause();
      return;
    }

    if (Input.wasPressed('F3')) {
      this.debugOverlay = !this.debugOverlay;
    }

    // Action menu is processed FIRST so it can consume arrow keys before the
    // player ship's handleInput sees them.
    const menuResult = this.actionMenu.update(this.state, this.camera);
    this.handleActionResult(menuResult);

    // Update aim point from current mouse position so the ship's mouse-aim
    // logic in handleInput sees a fresh target this tick.
    if (this.state.player.alive) {
      const aimWorld = this.camera.screenToWorld(Input.mousePos);
      this.state.player.setAimPoint(aimWorld);
    }

    this.updateNumberGroupHotkeys();
    this.updatePlayerFighterOrderTargets();

    // LAN host OR online host: apply buffered remote inputs BEFORE the simulation tick so
    // remote players' inputs are always included in the current frame.
    if (this.state.gameMode === 'lan_host' || this.state.gameMode === 'online_host') {
      this.applyRemoteLanInputs();
      // Tick all LAN AI directors (they steer their ships before state.update).
      for (const dir of this.lanAiDirectors) {
        dir.update(this.state, DT);
        for (const msg of dir.drainChats()) {
          this.hud.showAIChat('RIVAL', msg, Colors.alert1);
        }
      }
    }

    // Update core game state (entities, collision, power, resources, research, particles)
    this.state.update(DT);

    // Detect player damage events to trigger the screen damage flash.
    if (this.state.player.alive) {
      const curHealth = this.state.player.health;
      if (this.playerPrevHealth >= 0 && curHealth < this.playerPrevHealth) {
        this.damageFlashTimer = 0.35;
      }
      this.playerPrevHealth = curHealth;
    } else {
      this.playerPrevHealth = -1;
    }
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= DT;

    // Advance territory pulse time for animated territory circle effects.
    this.territoryPulseTime += DT;

    // Player respawn logic — trigger on death and revive after a short delay.
    this.updatePlayerRespawn();

    // Advance starfield animations (twinkling, shooting stars)
    this.starfield.update(DT);

    // Camera follows player
    this.camera.update(this.state.player.position, DT);

    // Emit exhaust particles when the player is thrusting (any WASD key).
    // Exhaust trails opposite the actual thrust direction, which under the new
    // mouse-aim controls is decoupled from the ship's facing. When boosting
    // (Shift held), emit extra particles for a more intense visual.
    if (this.state.player.alive && this.state.player.isThrusting && !this.actionMenu.open) {
      const td = this.state.player.thrustDir;
      const thrustAngle = Math.atan2(td.y, td.x);
      const exhaustCount = this.state.player.isBoosting ? 3 : 1;
      const speed = Math.hypot(this.state.player.velocity.x, this.state.player.velocity.y);
      const maxSpeed = this.state.player.maxSpeed * (this.state.player.isBoosting ? 1.8 : 1);
      const speedFraction = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
      for (let i = 0; i < exhaustCount; i++) {
        this.state.particles.emitExhaust(
          this.state.player.position,
          thrustAngle,
          Team.Player,
          { speedFraction, varyLightness: true },
        );
      }
    }

    // Emit side exhaust particles when strafing (thrust direction is roughly
    // perpendicular to the ship's facing — happens naturally with WASD + aim).
    if (this.state.player.alive) {
      if (this.state.player.isStrafingLeft) {
        this.state.particles.emitSideExhaust(
          this.state.player.position,
          this.state.player.angle,
          -1,
          Team.Player,
          {
            speedFraction: this.playerSpeedFraction(),
            varyLightness: true,
          },
        );
      }
      if (this.state.player.isStrafingRight) {
        this.state.particles.emitSideExhaust(
          this.state.player.position,
          this.state.player.angle,
          1,
          Team.Player,
          {
            speedFraction: this.playerSpeedFraction(),
            varyLightness: true,
          },
        );
      }
    }

    for (const f of this.state.fighters) {
      if (!f.alive || f.docked) continue;
      const speed = Math.hypot(f.velocity.x, f.velocity.y);
      const maxSpeed = this.fighterMaxSpeed(f);
      const speedFraction = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
      if (speedFraction <= 0.05) continue;
      this.state.particles.emitExhaust(
        f.position,
        f.angle,
        f.team,
        { speedFraction, scaleSizeWithSpeed: true },
      );
    }

    // Skip song with N key
    if (Input.wasPressed('n')) {
      Audio.skipSong();
    }

    // Open radar sound when Tab is first pressed (full-screen radar hold key)
    if (Input.wasPressed('Tab')) {
      Audio.playSound('openradar');
    }

    // Player drive loop — run while any WASD movement key is held
    if (this.state.player.alive && this.state.player.isThrusting && !this.actionMenu.open) {
      Audio.startDriveLoop();
    } else {
      Audio.stopDriveLoop();
    }

    // Player firing
    this.updateGuidedMissileControl();
    this.updatePlayerFiring();

    // Player ship fighter spawning from shipyards
    this.updatePlayerShipyards();
    this.updatePlayerFighterCombat();

    // Inject fluid forces from all active entities.
    this.spaceFluid.setView(this.camera.position.x, this.camera.position.y, this.camera.zoom);
    this.injectFluidForces();

    // HUD
    this.hud.update(DT);

    // Mode-specific logic
    if (this.state.gameMode === 'practice' || this.state.gameMode === 'vs_ai') {
      this.practiceMode.update(this.state, this.hud, DT);
    } else if (this.state.gameMode === 'tutorial') {
      this.tutorialMode.update(this.state, this.hud, DT);
    } else if (this.state.gameMode === 'lan_host' || this.state.gameMode === 'online_host') {
      // Broadcast snapshot on interval (remote inputs were applied above).
      this.lanSnapshotTimer -= DT;
      if (this.lanSnapshotTimer <= 0) {
        this.lanSnapshotTimer = Game.SNAPSHOT_INTERVAL;
        if (this.state.gameMode === 'online_host' && this.onlineTransport) {
          this.broadcastOnlineSnapshot();
        } else {
          this.broadcastLanSnapshot();
        }
      }
    } else if (this.state.gameMode === 'lan_client' || this.state.gameMode === 'online_client') {
      // Send local input to the server every tick.
      if (this.state.gameMode === 'online_client' && this.onlineTransport) {
        this.sendOnlineInput();
      } else {
        this.sendLanInput();
      }
      // Decay the prediction correction offset toward zero.
      if (this.lanPredictionOffsetAlpha > 0) {
        const decay = DT / Game.LAN_PREDICTION_BLEND_SECS;
        this.lanPredictionOffsetAlpha = Math.max(0, this.lanPredictionOffsetAlpha - decay);
        if (this.lanPredictionOffsetAlpha > 0 && this.state.player.alive) {
          // Apply the remaining fraction of the correction offset each tick.
          this.state.player.position.x += this.lanPredictionOffset.x * decay;
          this.state.player.position.y += this.lanPredictionOffset.y * decay;
        } else {
          this.lanPredictionOffset = { x: 0, y: 0 };
        }
      }
    }

    // Vs. AI bot-player: tick the strategic director every frame. The
    // director itself runs cheap decisions on a difficulty-scaled
    // interval; the per-tick driveShip just steers / fires.
    if (this.vsAIDirector) {
      this.vsAIDirector.update(this.state, DT);
      // Drain rival AI chat and forward to HUD.
      for (const msg of this.vsAIDirector.drainChats()) {
        this.hud.showAIChat('RIVAL', msg, Colors.alert1);
      }
    }
  }

  /**
   * Detect player death, show a respawn countdown, then revive the ship near
   * the command post. Deducts resources proportional to how many buildings
   * and research items the player has (the more powerful your base, the more
   * it costs to die) — clamped to zero so you can never go negative.
   */
  private updatePlayerRespawn(): void {
    if (this.state.player.alive) {
      // Reset tracking whenever the player is alive.
      this.playerDeathHandled = false;
      this.playerRespawnTimer = 0;
      return;
    }

    // First frame of death — register it.
    if (!this.playerDeathHandled) {
      this.playerDeathHandled = true;
      this.playerRespawnTimer = Game.RESPAWN_DELAY;

      const penalty = 40 + this.countShipResearchUpgrades() * 10;
      this.state.resources = Math.max(0, this.state.resources - penalty);

      this.hud.showMessage(
        `Ship destroyed! Respawning in ${Game.RESPAWN_DELAY}s  (-${penalty} resources)`,
        Colors.alert1,
        Game.RESPAWN_DELAY + 1,
      );
    }

    // Count down and respawn when the timer expires.
    this.playerRespawnTimer -= DT;
    if (this.playerRespawnTimer <= 0) {
      const cp = this.state.getPlayerCommandPost();
      const spawnPos = cp
        ? new Vec2(cp.position.x, cp.position.y - 60)
        : new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);

      this.state.player.revive(spawnPos);
      this.hud.showMessage('Respawned!', Colors.friendly_status, 2);
    }
  }

  private countShipResearchUpgrades(): number {
    let count = 0;
    for (const key of this.state.researchedItems) {
      if (key === 'shipHull' || key === 'shipBattery' || key === 'shipEngine' || key === 'shipShield') count++;
    }
    return count;
  }

  private updatePlayerFiring(): void {
    if (!this.state.player.alive) return;
    const player = this.state.player;

    if (this.actionMenu.open || this.actionMenu.placementMode) {
      // Cancel laser charge if the player opened the menu while charging
      if (player.isLaserCharging && !Input.mouse2Down) {
        player.isLaserCharging = false;
        player.laserChargeTimer = 0;
      }
      return;
    }

    const aimWorld = this.camera.screenToWorld(Input.mousePos);

    // --- Gatling overdrive: auto-fires at extreme rate, no LMB required ---
    if (player.gatlingOverdriveTimer > 0) {
      // Overdrive fire rate is much faster than normal; divide the base interval
      const overdriveCooldown =
        WEAPON_STATS.gatling.fireRate * DT * player.fireCooldownMultiplier / GATLING_OVERDRIVE_FIRE_RATE_DIVISOR;
      if (player.primaryFireTimer <= 0 && player.battery >= GATLING_BATTERY_FIRE_COST) {
        player.consumePrimaryFire(overdriveCooldown, GATLING_BATTERY_FIRE_COST);
        const spread = randomRange(-Math.PI / 36, Math.PI / 36);
        this.state.addEntity(new GatlingBullet(
          Team.Player, player.position.clone(), player.angle + spread, player,
        ));
        Audio.playSound('shortbullet');
      }
      player.gatlingOverdriveTimer -= DT;
      if (player.gatlingOverdriveTimer <= 0) {
        player.gatlingOverdriveTimer = 0;
        player.gatlingOverheatTimer = GATLING_OVERHEAT_DURATION_SECS;
        this.hud.showMessage('GATLING OVERHEAT — immobilised for 4s', Colors.alert1, 4.5);
        Audio.playSound('explode0');
      }
      return; // no other firing during overdrive
    }

    // --- Gatling overheat lockdown: no movement or firing ---
    if (player.gatlingOverheatTimer > 0) {
      player.gatlingOverheatTimer -= DT;
      if (player.gatlingOverheatTimer <= 0) {
        player.gatlingOverheatTimer = 0;
        this.hud.showMessage('System cooled', Colors.friendly_status, 2);
      }
      return; // no firing during overheat
    }

    // --- Primary fire (LMB) ---
    if (Input.mouseDown && player.canFirePrimary()) {
      this.fireSelectedPrimary(aimWorld);
    }

    // --- Weapon special ability (RMB) ---
    this.handleWeaponSpecial(aimWorld);
  }

  /**
   * Dispatch the right-click (RMB) special ability for the equipped weapon.
   * Each weapon has its own unique ability; the fallback is the registered
   * special ability from special.ts (homing missile).
   */
  private handleWeaponSpecial(aimWorld: Vec2): void {
    const player = this.state.player;
    const weapon = player.primaryWeaponId;

    if (weapon === 'gatling' && this.state.researchedItems.has('weaponGatling')) {
      this.handleGatlingSpecial();
    } else if (weapon === 'laser' && this.state.researchedItems.has('weaponLaser')) {
      this.handleLaserSpecial(aimWorld);
    } else if (weapon === 'guidedmissile' && this.state.researchedItems.has('weaponGuidedMissile')) {
      this.handleRocketSwarmSpecial(aimWorld);
    } else if (weapon === 'cannon') {
      this.handleCannonHomingSpecial(aimWorld);
    } else {
      // Fallback: registered special ability (missile)
      if (Input.mouse2Down) {
        tryFireSpecial(this.state, player, aimWorld);
      }
    }
  }

  /**
   * Gatling gun special (RMB): enter overdrive — extreme auto-fire for
   * GATLING_OVERDRIVE_DURATION_SECS, then GATLING_OVERHEAT_DURATION_SECS of
   * complete immobility.
   */
  private handleGatlingSpecial(): void {
    const player = this.state.player;
    if (!Input.mouse2Pressed) return;
    if (player.gatlingOverdriveTimer > 0 || player.gatlingOverheatTimer > 0) return;
    if (player.battery < GATLING_BATTERY_FIRE_COST) return;

    player.gatlingOverdriveTimer = GATLING_OVERDRIVE_DURATION_SECS;
    this.hud.showMessage('GATLING OVERDRIVE!', Colors.alert2, 2.5);
    Audio.playSound('shortbullet');
  }

  /**
   * Laser special (RMB): hold to charge, release to fire a wide energy burst.
   * Consumes all current battery; damage and beam width scale with charge
   * fraction and energy spent.
   */
  private handleLaserSpecial(aimWorld: Vec2): void {
    const player = this.state.player;

    if (player.weaponSpecialCooldown > 0) {
      if (player.isLaserCharging && !Input.mouse2Down) {
        player.isLaserCharging = false;
        player.laserChargeTimer = 0;
      }
      return;
    }

    if (Input.mouse2Down) {
      if (!player.isLaserCharging) {
        if (player.battery > 0) {
          player.isLaserCharging = true;
          player.laserChargeTimer = 0;
        }
      } else {
        player.laserChargeTimer = Math.min(player.laserChargeTimer + DT, LASER_MAX_CHARGE_SECS);
      }
    }

    if (player.isLaserCharging && !Input.mouse2Down) {
      player.isLaserCharging = false;
      if (player.battery > 0 && player.laserChargeTimer > 0.15) {
        const energySpent = player.battery;
        const chargeFraction = Math.min(1, player.laserChargeTimer / LASER_MAX_CHARGE_SECS);
        // Damage scales with both energy available and charge fraction.
        // LASER_BURST_BASE_MULTIPLIER is the floor at empty battery / no charge;
        // LASER_BURST_ENERGY_SCALING adds up to 8× extra at full battery + full charge.
        const burstDamage =
          WEAPON_STATS.laser.damage * (LASER_BURST_BASE_MULTIPLIER + (energySpent / player.maxBattery) * LASER_BURST_ENERGY_SCALING * chargeFraction);
        const burstRange = WEAPON_STATS.laser.range * (1.5 + chargeFraction * 0.5);
        const hitRadius = 2 + chargeFraction * 14; // wider beam hits larger area

        player.battery = 0;
        const start = player.position.clone();
        const end = new Vec2(
          start.x + Math.cos(player.angle) * burstRange,
          start.y + Math.sin(player.angle) * burstRange,
        );
        this.state.addEntity(new ChargedLaserBurst(Team.Player, start, end, player, chargeFraction));
        this.damageLaserLine(start, end, burstDamage, hitRadius);
        player.weaponSpecialCooldown = LASER_CHARGE_COOLDOWN_SECS;
        player.laserChargeTimer = 0;
        Audio.playSound('laser');
      } else {
        player.laserChargeTimer = 0;
      }
    }
  }

  /**
   * Guided missile special (RMB): launch a spread swarm of
   * ROCKET_SWARM_COUNT small blast missiles.  Each swarm missile has a blast
   * radius, is interceptable by enemy bullets, and detonates on impact.
   */
  private handleRocketSwarmSpecial(aimWorld: Vec2): void {
    const player = this.state.player;
    if (!Input.mouse2Pressed) return;
    if (player.weaponSpecialCooldown > 0) return;
    if (player.battery < ROCKET_SWARM_ENERGY_COST) return;

    player.battery -= ROCKET_SWARM_ENERGY_COST;
    player.weaponSpecialCooldown = ROCKET_SWARM_COOLDOWN_SECS;

    const baseAngle = player.position.angleTo(aimWorld);
    const spreadRad = ROCKET_SWARM_SPREAD_DEGREES * (Math.PI / 180);
    const count = ROCKET_SWARM_COUNT;

    for (let i = 0; i < count; i++) {
      // Spread missiles evenly across the fan angle
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      const angle = baseAngle + t * spreadRad;
      this.state.addEntity(new SwarmMissile(Team.Player, player.position.clone(), angle, player));
    }
    Audio.playSound('missile');
    this.hud.showMessage('Missile swarm!', Colors.alert2, 1.5);
  }

  /**
   * Cannon special (RMB): fire a homing bullet that steers toward the nearest
   * enemy.  Costs CANNON_HOMING_ENERGY_COST (3× normal cannon shot).
   */
  private handleCannonHomingSpecial(aimWorld: Vec2): void {
    const player = this.state.player;
    if (!Input.mouse2Pressed) return;
    if (player.weaponSpecialCooldown > 0) return;
    if (player.battery < CANNON_HOMING_ENERGY_COST) return;

    // Find nearest enemy within lock-on range
    let target: Entity | null = null;
    let bestDist = 600;
    for (const e of this.state.getEnemiesOf(Team.Player)) {
      if (!this.isHomingTarget(e)) continue;
      const d = player.position.distanceTo(e.position);
      if (d < bestDist) { bestDist = d; target = e; }
    }

    player.battery -= CANNON_HOMING_ENERGY_COST;
    player.weaponSpecialCooldown = CANNON_HOMING_COOLDOWN_SECS;
    const launchAngle = target ? player.position.angleTo(target.position) : player.position.angleTo(aimWorld);
    this.state.addEntity(new HomingBullet(Team.Player, player.position.clone(), launchAngle, player, target));
    Audio.playSound('fire');
  }

  private updatePlayerShipyards(): void {
    for (const b of this.state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      if (!(b instanceof Shipyard)) continue;
      if (this.state.researchedItems.has('advancedFighters')) {
        b.shipCapacity = 7;
        b.buildInterval = 4;
      }
      b.dockedShips = this.state.fighters.filter(
        (f) => f.alive && f.homeYard === b && f.docked,
      ).length;

      if (b.shouldSpawnShip()) {
        const isBomber = b.type === EntityType.BomberYard;
        const group = b.assignedGroup;
        const synonymous = isSynonymousFaction(this.state.factionByTeam, Team.Player);
        const spawnPos = synonymous ? b.bayPosition() : b.position.clone();
        const fighter = isBomber
          ? synonymous
            ? new SynonymousNovaBomberShip(spawnPos.clone(), Team.Player, group, b)
            : new BomberShip(spawnPos.clone(), Team.Player, group, b)
          : synonymous
            ? new SynonymousFighterShip(spawnPos.clone(), Team.Player, group, b, this.state.researchedItems.has('advancedFighters'))
            : new FighterShip(spawnPos.clone(), Team.Player, group, b);
        if (!synonymous && !isBomber && this.state.researchedItems.has('advancedFighters')) fighter.weaponDamage = 2;
        b.activeShips++;
        this.state.addEntity(fighter);
        b.dockedShips++;
        const waypoint = this.getWaypointForGroup(group);
        if (waypoint && !b.holdDocked) {
          fighter.order = 'waypoint';
          fighter.targetPos = waypoint.clone();
          fighter.launch();
          b.dockedShips = Math.max(0, b.dockedShips - 1);
        }
      }
    }
  }

  private fireSelectedPrimary(aimWorld: Vec2): void {
    const weapon = this.state.player.primaryWeaponId;
    if (weapon === 'gatling' && this.state.researchedItems.has('weaponGatling')) {
      this.state.player.consumePrimaryFire(
        WEAPON_STATS.gatling.fireRate * DT * this.state.player.fireCooldownMultiplier,
        GATLING_BATTERY_FIRE_COST,
      );
      const spread = randomRange(-Math.PI / 60, Math.PI / 60);
      this.state.addEntity(new GatlingBullet(
        Team.Player,
        this.state.player.position.clone(),
        this.state.player.angle + spread,
        this.state.player,
      ));
      Audio.playSound('shortbullet');
      return;
    }
    if (weapon === 'guidedmissile' && this.state.researchedItems.has('weaponGuidedMissile')) {
      if (this.activeGuidedMissile?.alive) return;
      if (this.state.player.battery < GUIDED_MISSILE_INITIAL_BATTERY_COST) return;
      this.state.player.consumePrimaryFire(
        WEAPON_STATS.guidedmissile.fireRate * DT * this.state.player.fireCooldownMultiplier,
        GUIDED_MISSILE_INITIAL_BATTERY_COST,
      );
      const missile = new GuidedMissile(
        Team.Player,
        this.state.player.position.clone(),
        this.state.player.angle,
        this.state.player,
      );
      missile.steerToward(aimWorld);
      this.activeGuidedMissile = missile;
      this.state.addEntity(missile);
      Audio.playSound('missile');
      return;
    }
    if (weapon === 'laser' && this.state.researchedItems.has('weaponLaser')) {
      this.state.player.consumePrimaryFire(WEAPON_STATS.laser.fireRate * DT * this.state.player.fireCooldownMultiplier);
      const start = this.state.player.position.clone();
      const end = new Vec2(
        start.x + Math.cos(this.state.player.angle) * WEAPON_STATS.laser.range,
        start.y + Math.sin(this.state.player.angle) * WEAPON_STATS.laser.range,
      );
      this.state.addEntity(new Laser(Team.Player, start, end, this.state.player));
      this.damageLaserLine(start, end, WEAPON_STATS.laser.damage);
      Audio.playSound('laser');
      return;
    }
    if (weapon === 'synonymousLaser' && isSynonymousFaction(this.state.factionByTeam, Team.Player)) {
      const player = this.state.player;
      const cooldown = player.synonymousLaserCooldown(WEAPON_STATS.synonymousLaser.fireRate * DT);
      player.consumePrimaryFire(cooldown);
      player.synonymousMuzzleFlash = 0.22;
      const start = player.position.clone();
      const end = new Vec2(
        start.x + Math.cos(player.angle) * WEAPON_STATS.synonymousLaser.range,
        start.y + Math.sin(player.angle) * WEAPON_STATS.synonymousLaser.range,
      );
      this.state.addEntity(new Laser(Team.Player, start, end, player));
      this.damageLaserLineLimited(
        start,
        end,
        WEAPON_STATS.synonymousLaser.damage,
        5,
        WEAPON_STATS.synonymousLaser.pierce * player.synonymousPierceMultiplier,
      );
      Audio.playSound('laser');
      return;
    }

    this.state.player.consumePrimaryFire(PLAYER_FIRE_COOLDOWN * this.state.player.fireCooldownMultiplier);
    this.state.addEntity(new Bullet(
      Team.Player,
      this.state.player.position.clone(),
      this.state.player.angle,
      this.state.player,
      this.findClosestEnemyForTeam(this.state.player.position, Team.Player, 520),
    ));
    Audio.playSound('fire');
  }

  private updateGuidedMissileControl(): void {
    const missile = this.activeGuidedMissile;
    if (!missile) return;
    if (!missile.alive) {
      this.activeGuidedMissile = null;
      return;
    }
    if (!Input.mouseDown || this.actionMenu.open || this.actionMenu.placementMode) {
      missile.release();
      this.activeGuidedMissile = null;
      return;
    }
    const stillPowered = this.state.player.drainBattery(GUIDED_MISSILE_CONTROL_BATTERY_DRAIN * DT);
    if (!stillPowered) {
      missile.release();
      this.activeGuidedMissile = null;
      return;
    }
    missile.steerToward(this.camera.screenToWorld(Input.mousePos));
  }

  private damageLaserLine(start: Vec2, end: Vec2, damage: number, hitRadius: number = 2): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return;
    for (const target of this.state.allEntities()) {
      // Skip neutrals and own-team entities
      if (!target.alive || target.team === Team.Player || target.team === Team.Neutral) continue;
      const tx = target.position.x - start.x;
      const ty = target.position.y - start.y;
      const t = Math.max(0, Math.min(1, (tx * dx + ty * dy) / lenSq));
      const px = start.x + dx * t;
      const py = start.y + dy * t;
      const dist = Math.hypot(target.position.x - px, target.position.y - py);
      if (dist <= target.radius + hitRadius) {
        target.takeDamage(damage, this.state.player);
        this.state.recentlyDamaged.add(target.id);
        if (!target.alive) {
          this.state.particles.emitExplosion(target.position, target.radius);
          this.spaceFluid.addExplosion(target.position.x, target.position.y, 1.2, 214, 134, 48); // warm orange explosion
        } else {
          this.state.particles.emitSpark(target.position);
        }
      }
    }
  }

  private handleActionResult(result: MenuResult): void {
    switch (result.action) {
      case 'build':
        this.placeBuilding(result.buildingType, result.cell);
        break;
      case 'order':
        this.issueShipOrder(result.group, result.order);
        break;
      case 'research':
        this.startResearch(result.item);
        break;
      default:
        break;
    }
  }

  private placeBuilding(type: string, cellOverride?: { cx: number; cy: number }): void {
    const def = getBuildDef(type);
    if (!def) return;

    // Snap placement to the grid cell nearest the cursor.
    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    const cell = cellOverride ?? worldToCell(aimWorld);
    const worldPos = footprintCenter(cell.cx, cell.cy, def.footprintCells);

    const status = this.state.getPlacementStatus(def, cell.cx, cell.cy, Team.Player);
    if (!status.valid) {
      this.hud.showMessage(status.reason, Colors.alert1, 3);
      return;
    }

    const building = createBuildingFromDef(def, worldPos, Team.Player);
    if (isSynonymousFaction(this.state.factionByTeam, Team.Player)) {
      const cost = SYNONYMOUS_BUILD_COST[type] ?? 0;
      const kind = type === 'missileturret' ? 'laserturret' : type === 'synonymousminelayer' ? 'minelayer' : type === 'factory' ? 'factory' : type === 'researchlab' ? 'researchlab' : 'swarm';
      building.synonymousVisualKind = kind === 'swarm' ? null : kind;
      if (kind === 'laserturret' && building instanceof TurretBase) {
        building.fireRate = 6;
        building.range = 240;
      }
      if (cost > 0 && !this.state.synonymous.allocateToBuilding(Team.Player, building.id, kind, worldPos, cost, this.state.gameTime)) {
        this.hud.showMessage(`Need ${cost} ${SYNONYMOUS_CURRENCY_SYMBOL}`, Colors.alert1, 3);
        return;
      }
    } else {
      const conduitRefund = this.state.sellReplaceableConduitsUnderFootprint(def, cell.cx, cell.cy, Team.Player);
      this.state.resources += conduitRefund - def.cost;
    }
    this.state.addEntity(building);
    this.state.applyConfluencePlacement(Team.Player, worldPos, String(building.id));
    this.state.selectedBuildType = type;
    Audio.playSound('build');
    this.hud.showMessage(`Building ${def.label}…`, Colors.general_building, 2);
  }

  private issueShipOrder(group: ShipCommandGroup, order: string): void {
    const fighters = this.getPlayerFightersForCommand(group);
    const label = this.groupLabel(group);

    switch (order) {
      case 'waypoint': {
        const target = this.camera.screenToWorld(Input.mousePos);
        this.recordWaypointMarker(group, target);
        for (const yard of this.playerShipyardsForCommand(group)) {
          yard.holdDocked = false;
        }
        for (const f of fighters) {
          f.order = 'waypoint';
          f.targetPos = target.clone();
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${label}: Waypoint`, Colors.general_building, 2);
        break;
      }
      case 'dock':
        this.clearWaypointMarker(group);
        for (const yard of this.playerShipyardsForCommand(group)) {
          yard.holdDocked = true;
        }
        for (const f of fighters) {
          f.order = 'dock';
        }
        this.hud.showMessage(`${label}: Dock`, Colors.general_building, 2);
        break;
      case 'protect': {
        this.clearWaypointMarker(group);
        const cp = this.state.getPlayerCommandPost();
        const protectPos = cp?.position ?? this.state.player.position;
        for (const f of fighters) {
          f.order = 'protect';
          f.targetPos = protectPos.clone();
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${label}: Protect Base`, Colors.general_building, 2);
        break;
      }
      case 'follow': {
        this.clearWaypointMarker(group);
        for (const f of fighters) {
          f.order = 'follow';
          f.targetPos = this.state.player.position.clone();
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${label}: Follow Player`, Colors.general_building, 2);
        break;
      }
      default:
        break;
    }
  }

  private startResearch(item: string): void {
    if (!this.state.hasResearchLab()) {
      this.hud.showMessage('Build a Research Lab first!', Colors.alert1, 3);
      return;
    }

    if (this.state.researchProgress.item) {
      this.hud.showMessage('Research already in progress!', Colors.alert2, 3);
      return;
    }

    const costKey = item as keyof typeof RESEARCH_COST;
    const timeKey = item as keyof typeof RESEARCH_TIME;
    const cost = RESEARCH_COST[costKey];
    const time = RESEARCH_TIME[timeKey];

    if (cost === undefined || time === undefined) return;
    if (!(ACTIVE_RESEARCH_ITEMS as readonly string[]).includes(item)) return;

    if (isSynonymousFaction(this.state.factionByTeam, Team.Player)) {
      if (!this.state.synonymous.canSpend(Team.Player, cost)) {
        this.hud.showMessage(`Need ${cost} ${SYNONYMOUS_CURRENCY_SYMBOL} for research!`, Colors.alert1, 3);
        return;
      }
      this.state.synonymous.spendFreeDrones(Team.Player, cost, this.state.player.position);
    } else {
      if (this.state.resources < cost) {
        this.hud.showMessage('Not enough resources for research!', Colors.alert1, 3);
        return;
      }
      this.state.resources -= cost;
    }
    this.state.researchProgress = {
      item,
      progress: 0,
      timeNeeded: time / TICK_RATE,
    };
    this.hud.showMessage(`Researching: ${item}`, Colors.researchlab_detail, 3);
  }

  private getPlayerFightersForCommand(group: ShipCommandGroup): FighterShip[] {
    if (group === 'all') {
      return this.state.fighters.filter((f) => f.alive && f.team === Team.Player);
    }
    return this.state.getFightersByGroup(Team.Player, group);
  }

  private groupLabel(group: ShipCommandGroup): string {
    return group === 'all' ? 'ALL' : `Group ${group + 1}`;
  }

  private groupFromHeldNumber(): ShipGroup | null {
    if (Input.isDown('1')) return ShipGroup.Red;
    if (Input.isDown('2')) return ShipGroup.Green;
    if (Input.isDown('3')) return ShipGroup.Blue;
    return null;
  }

  private updateNumberGroupHotkeys(): void {
    const group = this.groupFromHeldNumber();
    if (group === null) return;

    if (Input.mouse2Pressed) {
      Input.consumeMouseButton(2);
      this.issueShipOrder(group, 'dock');
      return;
    }

    if (!Input.mousePressed) return;
    Input.consumeMouseButton(0);

    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    const yard = this.findPlayerShipyardAt(aimWorld);
    if (yard) {
      yard.assignedGroup = group;
      for (const f of this.state.fighters) {
        if (f.alive && f.team === Team.Player && f.homeYard === yard) {
          f.group = group;
        }
      }
      this.hud.showMessage(`Shipyard assigned to ${group + 1}`, Colors.alert2, 2);
      return;
    }

    const fighters = this.state.getFightersByGroup(Team.Player, group);
    this.recordWaypointMarker(group, aimWorld);
    for (const yard of this.playerShipyardsForCommand(group)) {
      yard.holdDocked = false;
    }
    for (const f of fighters) {
      f.order = 'waypoint';
      f.targetPos = aimWorld.clone();
      if (f.docked) f.launch();
    }
    this.hud.showMessage(`Group ${group + 1}: Waypoint`, Colors.general_building, 2);
  }

  private recordWaypointMarker(group: ShipCommandGroup, pos: Vec2): void {
    if (group === 'all') {
      this.waypointMarkers.clear();
      this.waypointMarkers.set('all', { pos: pos.clone(), issuedAt: this.state.gameTime });
      return;
    }
    this.waypointMarkers.delete('all');
    this.waypointMarkers.set(group, { pos: pos.clone(), issuedAt: this.state.gameTime });
  }

  private clearWaypointMarker(group: ShipCommandGroup): void {
    if (group === 'all') {
      this.waypointMarkers.clear();
      return;
    }
    this.waypointMarkers.delete(group);
    this.waypointMarkers.delete('all');
  }

  private getWaypointForGroup(group: ShipGroup): Vec2 | null {
    return this.waypointMarkers.get(group)?.pos.clone()
      ?? this.waypointMarkers.get('all')?.pos.clone()
      ?? null;
  }

  private playerShipyardsForCommand(group: ShipCommandGroup): Shipyard[] {
    return this.state.buildings.filter(
      (b): b is Shipyard =>
        b.alive &&
        b.team === Team.Player &&
        b instanceof Shipyard &&
        (group === 'all' || b.assignedGroup === group),
    );
  }

  private findPlayerShipyardAt(pos: Vec2): Shipyard | null {
    let best: Shipyard | null = null;
    let bestDist = Infinity;
    for (const b of this.state.buildings) {
      if (!b.alive || b.team !== Team.Player || !(b instanceof Shipyard)) continue;
      const d = b.position.distanceTo(pos);
      if (d <= b.radius * 1.8 && d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    return best;
  }

  private findNearestEnemyBuildingOfType(type: EntityType): BuildingBase | null {
    let best: BuildingBase | null = null;
    let bestDist = Infinity;
    for (const b of this.state.buildings) {
      if (!b.alive || b.team !== Team.Enemy || b.type !== type) continue;
      const d = b.position.distanceTo(this.state.player.position);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  private updatePlayerFighterOrderTargets(): void {
    const cp = this.state.getPlayerCommandPost();
    for (const f of this.state.fighters) {
      if (!f.alive || f.team !== Team.Player || f.docked) continue;
      if (f.order === 'follow') {
        f.targetPos = this.state.player.position.clone();
      } else if (f.order === 'protect') {
        const basePos = cp?.position ?? this.state.player.position;
        const threat = this.findNearestEnemyNear(basePos, 650);
        f.targetPos = threat?.position.clone() ?? basePos.clone();
      }
    }
  }

  private updatePlayerFighterCombat(): void {
    for (const f of this.state.fighters) {
      if (!f.alive || f.docked || f.team !== Team.Player) continue;
      if (!(f instanceof BomberShip) && !(f instanceof SynonymousFighterShip)) {
        f.weaponDamage = this.state.researchedItems.has('advancedFighters') ? 2 : 1;
      }
      if (!f.canFire()) continue;

      const nearby = this.state.getEntitiesInRange(f.position, f.weaponRange);
      let target = null;
      let bestDist = Infinity;
      for (const e of nearby) {
        if (!e.alive || e.team !== Team.Enemy) continue;
        const d = f.position.distanceTo(e.position);
        if (d < bestDist) {
          bestDist = d;
          target = e;
        }
      }
      if (!target) continue;
      const angle = f.position.angleTo(target.position);
      if (f instanceof SynonymousNovaBomberShip) {
        const charged = f.consumeChargedNova();
        if (charged) {
          const angle = f.position.angleTo(charged.target);
          this.state.addEntity(new SynonymousNovaBomb(f.team, f.position.clone(), angle, charged.aoeRadius, charged.damage, charged.travel, f));
          Audio.playSound('laser');
        } else {
          f.beginNovaCharge(target.position);
        }
      } else if (f instanceof BomberShip) {
        f.consumeShot(WEAPON_STATS.bigmissile.fireRate);
        this.state.addEntity(new BomberMissile(f.team, f.position.clone(), angle, f));
        Audio.playSound('missile');
      } else if (f instanceof SynonymousFighterShip) {
        f.markCombatSplit();
        f.consumeShot(f.fireRate);
        for (let i = 0; i < f.droneCount; i++) {
          const start = f.firingOrigin(i);
          const end = target.position.clone();
          this.state.addEntity(new SynonymousDroneLaser(f.team, start, end, f));
          this.damageLaserLineLimited(start, end, f.weaponDamage, 3, 2, f);
        }
        Audio.playSound('laser');
      } else {
        f.consumeShot(WEAPON_STATS.fire.fireRate);
        const bullet = new Bullet(f.team, f.position.clone(), angle, f, target);
        bullet.damage = f.weaponDamage;
        this.state.addEntity(bullet);
      }
    }
  }

  private findNearestEnemyNear(pos: Vec2, range: number): { position: Vec2 } | null {
    let best: { position: Vec2 } | null = null;
    let bestDist = range;
    for (const e of this.state.allEntities()) {
      if (!e.alive || e.team !== Team.Enemy) continue;
      const d = e.position.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private findClosestEnemyForTeam(pos: Vec2, team: Team, range: number): Entity | null {
    let best: Entity | null = null;
    let bestDist = range;
    for (const e of this.state.getEnemiesOf(team)) {
      if (!e.alive) continue;
      if (!this.isHomingTarget(e)) continue;
      const d = e.position.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private isHomingTarget(entity: Entity): boolean {
    return entity.type === EntityType.PlayerShip ||
      entity.type === EntityType.Fighter ||
      entity.type === EntityType.Bomber ||
      entity instanceof BuildingBase;
  }

  private injectFluidForces(): void {
    // ── Player ship ─────────────────────────────────────────────────────────
    if (this.state.player.alive) {
      const pv = this.state.player.velocity;
      this.spaceFluid.addForce({
        x: this.state.player.position.x, y: this.state.player.position.y,
        vx: pv.x,
        vy: pv.y,
        r: 56, g: 132, b: 68,   // friendly green exhaust
        strength: 1.0,
      });
    }

    // ── AI player ship (Vs. AI mode) ─────────────────────────────────────
    if (this.state.aiPlayerShip?.alive) {
      const ais = this.state.aiPlayerShip;
      const sv = ais.velocity;
      this.spaceFluid.addForce({
        x: ais.position.x, y: ais.position.y,
        vx: sv.x,
        vy: sv.y,
        r: 132, g: 56, b: 68,   // enemy red
        strength: 1.0,
      });
    }

    // ── All live fighters (player and enemy) ─────────────────────────────
    for (const f of this.state.fighters) {
      if (!f.alive || f.docked) continue;
      const fv = f.velocity;
      const isEnemy = f.team === Team.Enemy;
      this.spaceFluid.addForce({
        x: f.position.x, y: f.position.y,
        vx: fv.x,
        vy: fv.y,
        r: isEnemy ? 132 : 56,
        g: isEnemy ? 56 : 132,
        b: 68,
        strength: 0.6,
      });
    }

    // ── Projectiles ──────────────────────────────────────────────────────
    for (const e of this.state.allEntities()) {
      if (!e.alive) continue;
      // Only bullets / missiles / beams — skip ships and buildings.
      if (
        !(e instanceof Bullet) &&
        !(e instanceof GatlingBullet) &&
        !(e instanceof GuidedMissile) &&
        !(e instanceof BomberMissile) &&
        !(e instanceof Laser)
      ) continue;
      const ev = e.velocity;
      const isEnemy = e.team === Team.Enemy;
      this.spaceFluid.addForce({
        x: e.position.x, y: e.position.y,
        vx: ev.x,
        vy: ev.y,
        r: isEnemy ? 228 : 0,
        g: isEnemy ? 0 : 176,
        b: isEnemy ? 33 : 66,
        strength: 0.5,
      });
    }
  }

  private startGame(mode: 'tutorial' | 'practice' | 'vs_ai'): void {
    // Create fresh state
    const playerStart = new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);
    this.state = new GameState(playerStart);
    this.state.gameMode = mode;
    this.applyVisualQuality(this.visualQuality);
    // Reset any director from a previous match.
    this.vsAIDirector = null;

    // Reset respawn tracking.
    this.playerDeathHandled = false;
    this.playerRespawnTimer = 0;
    this.activeGuidedMissile = null;
    this.damageFlashTimer = 0;
    this.playerPrevHealth = -1;
    this.territoryPulseTime = 0;

    // Reset subsystems
    this.camera = new Camera();
    this.camera.setScreenSize(this.screenW, this.screenH);
    this.camera.position = playerStart.clone();
    this.actionMenu = new ActionMenu();
    this.hud = new HUD();
    this.waypointMarkers.clear();

    this.spaceFluid.reset();
    this.spaceFluid.resize(this.screenW, this.screenH);

    const practiceCfg = mode === 'practice' ? this.mainMenu.practiceConfig : null;
    const vsCfg = mode === 'vs_ai' ? this.mainMenu.vsAIConfig : null;
    const playerFaction = mode === 'tutorial'
      ? 'terran'
      : resolveRaceSelection(practiceCfg?.playerRace ?? vsCfg?.playerRace ?? 'terran', this.state.gameTime + 0.13);
    const enemyFaction = mode === 'practice'
      ? resolveRaceSelection(practiceCfg?.enemyRace ?? 'terran', this.state.gameTime + 0.71)
      : mode === 'vs_ai'
        ? resolveRaceSelection(vsCfg?.aiRace ?? 'terran', this.state.gameTime + 0.71)
        : 'terran';
    this.state.setFaction(Team.Player, playerFaction);
    this.state.setFaction(Team.Enemy, enemyFaction);

    // Create player command post near player
    const cpPos = new Vec2(playerStart.x, playerStart.y + 80);
    const cp = new CommandPost(cpPos, Team.Player);
    if (playerFaction === 'synonymous') cp.synonymousVisualKind = 'base';
    this.state.addEntity(cp);
    this.state.ensureConfluenceSeedCircle(Team.Player, cpPos);
    this.state.ensureSynonymousSeedSwarm(Team.Player, cpPos);

    // Seed a small starter conduit network around the player CP so that
    // shipyards / labs / factories placed near the CP can be powered
    // immediately. Without this, post-PR8 power rules (shipyards no
    // longer self-power) would force the player to paint conduits
    // before their first shipyard could function.
    if (!isConfluenceFaction(this.state.factionByTeam, Team.Player) && !isSynonymousFaction(this.state.factionByTeam, Team.Player)) {
      const startCx = Math.floor(cpPos.x / GRID_CELL_SIZE);
      const startCy = Math.floor(cpPos.y / GRID_CELL_SIZE);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= 2) {
            this.state.grid.addConduit(startCx + dx, startCy + dy, Team.Player);
          }
        }
      }
    }
    this.state.power.markDirty();

    // Set initial resources & spin up the appropriate mode driver.
    if (mode === 'tutorial') {
      this.state.resources = 50000;
      this.tutorialMode = new TutorialMode();
      this.tutorialMode.init(this.state, this.hud);
    } else if (mode === 'practice') {
      const cfg = this.mainMenu.practiceConfig;
      this.practiceMode = new PracticeMode();
      this.practiceMode.configure(cfg);
      // Apply unlocked research from setup.
      this.applyResearchUnlock(cfg.researchUnlocked);
      this.practiceMode.init(this.state, this.hud);
    } else {
      // Vs. AI: PracticeMode's growing-base opponent provides the
      // economy / construction / production framework; on top we
      // spawn an opposing AIShip + VsAIDirector that acts as a true
      // bot player (independent ship, harassment, retreat, APM).
      const vcfg = this.mainMenu.vsAIConfig;
      const pcfg = cloneDefaultPracticeConfig();
      pcfg.difficulty = vcfg.difficulty;
      pcfg.enemyIncomeMul = vcfg.cheat125xResources ? 1.25 : 1.0;
      pcfg.fogOfWar = vcfg.fogOfWar;
      pcfg.startingDistance = vcfg.startingDistance;
      pcfg.playerStartingResources = vcfg.startingResources;
      pcfg.enemyStartingResources = vcfg.startingResources;
      this.practiceMode = new PracticeMode();
      this.practiceMode.configure(pcfg);
      this.practiceMode.vsAIMode = true;
      this.practiceMode.init(this.state, this.hud);

      // Spawn the bot-player ship near the enemy CP.
      const enemyCP = this.state.getEnemyCommandPost();
      const aiShipPos = enemyCP
        ? new Vec2(enemyCP.position.x, enemyCP.position.y - 80)
        : playerStart.clone();
      const aiShip = new AIShip(aiShipPos);
      this.state.aiPlayerShip = aiShip;
      this.vsAIDirector = new VsAIDirector(aiShip, vcfg);
      // Wire up the planner so the director can coordinate defense/escort/harass.
      this.vsAIDirector.planner = this.practiceMode.getPlanner();

      this.hud.showMessage(
        `Vs. AI started — ${vcfg.difficulty}` +
          (vcfg.cheatFullMapKnowledge ? ' [+full map]' : '') +
          (vcfg.cheat125xResources ? ' [+1.25x res]' : ''),
        Colors.alert2, 4,
      );
    }

    // Start game
    this.phase = 'playing';
    this.mainMenu.close();
    Audio.stopDriveLoop();
    Audio.stopMusic();
    Audio.startPlaylist();
  }

  /**
   * Apply Practice setup's `researchUnlocked` setting by pre-populating
   * `state.researchedItems`. Cheap and additive.
   */
  private applyResearchUnlock(level: 'none' | 'basic_turrets' | 'all_turrets' | 'full_tech'): void {
    if (level === 'none') return;
    const basicTurrets = ['missileturret', 'exciterturret'];
    const allTurrets = ['missileturret', 'exciterturret', 'massdriverturret', 'regenturret'];
    const fullTech = [
      ...allTurrets,
      'bomberyard',
      'advancedFighters',
      'shipHp',
      'shipSpeedEnergy',
      'shipFireSpeed',
      'shipShield',
      'weaponGatling',
      'weaponLaser',
    ];
    const list = level === 'basic_turrets' ? basicTurrets
      : level === 'all_turrets' ? allTurrets
      : fullTech;
    for (const item of list) {
      this.state.researchedItems.add(item);
      this.state.player.applyResearchUpgrade(item);
    }
  }

  // -----------------------------------------------------------------------
  // LAN match startup & networking
  // -----------------------------------------------------------------------

  /**
   * Begin a LAN match. The host runs the authoritative simulation; remote
   * clients receive periodic snapshots and send their input each tick.
   */
  private startLanGame(matchStart: MsgMatchStart, isHost: boolean): void {
    this.lanMySlot = matchStart.mySlot;
    this.lanClient = this.mainMenu.getLanClient();
    this.lanRemoteInputs.clear();
    this.lanAiDirectors = [];
    this.lanSnapshotSeq = 0;
    this.lanInputSeq = 0;
    this.lanLastSnapshotSeq = -1;
    this.lanPredictionOffset = { x: 0, y: 0 };
    this.lanPredictionOffsetAlpha = 0;
    this.lanUnacknowledgedInputs = [];
    this.lanLastProcessedSeqPerSlot.clear();

    const myTeam = teamForSlot(this.lanMySlot);
    const myLobbySlot = matchStart.lobby.slots.find((s) => s.slotIndex === this.lanMySlot);
    const myFaction = resolveRaceSelection(myLobbySlot?.race ?? 'terran', matchStart.seed + this.lanMySlot * 0.37);
    const playerStart = new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);

    // Build fresh game state for host slot 0.
    this.state = new GameState(playerStart);
    this.state.gameMode = isHost ? 'lan_host' : 'lan_client';
    for (const slot of matchStart.lobby.slots) {
      if (slot.type === 'open' || slot.type === 'closed') continue;
      this.state.setFaction(teamForSlot(slot.slotIndex), resolveRaceSelection(slot.race ?? 'terran', matchStart.seed + slot.slotIndex * 0.37));
    }
    this.applyVisualQuality(this.visualQuality);
    this.vsAIDirector = null;
    this.playerDeathHandled = false;
    this.playerRespawnTimer = 0;
    this.activeGuidedMissile = null;
    this.damageFlashTimer = 0;
    this.playerPrevHealth = -1;
    this.territoryPulseTime = 0;
    this.camera = new Camera();
    this.camera.setScreenSize(this.screenW, this.screenH);
    this.camera.position = playerStart.clone();
    this.actionMenu = new ActionMenu();
    this.hud = new HUD();
    this.waypointMarkers.clear();
    this.spaceFluid.reset();
    this.spaceFluid.resize(this.screenW, this.screenH);

    // Set the local player ship's team from the assigned slot.
    this.state.playerShips.set(this.lanMySlot, new PlayerShip(playerStart, myTeam));
    // Also keep slot 0 accessible for backwards-compat single-player code.
    if (this.lanMySlot !== 0) {
      this.state.playerShips.set(0, this.state.playerShips.get(this.lanMySlot)!);
    }

    // For every non-local human slot, create a remote PlayerShip placeholder.
    for (const slot of matchStart.lobby.slots) {
      if (slot.type === 'human' && slot.slotIndex !== this.lanMySlot) {
        const remoteShip = new PlayerShip(playerStart.clone(), teamForSlot(slot.slotIndex));
        this.state.playerShips.set(slot.slotIndex, remoteShip);
      }
    }

    // Host: spawn AIShip + VsAIDirector for each AI slot.
    // Remote clients will receive AI ships via snapshots and don't run local AI.
    if (isHost) {
      for (const slot of matchStart.lobby.slots) {
        if (slot.type !== 'ai') continue;
        const aiTeam = teamForSlot(slot.slotIndex);
        // Place AI ship offset from centre so it doesn't overlap other ships.
        // Spread AI ships around the map centre, one per slot, with 300px spacing.
        // Slot indices 0–7 are offset from slot 4 (centre) so ships spread symmetrically.
        const AI_SPREAD_PX = 300;
        const aiStart = new Vec2(
          playerStart.x + (slot.slotIndex - 4) * AI_SPREAD_PX,
          playerStart.y - 400,
        );
        const aiShip = new AIShip(aiStart, aiTeam);
        this.state.playerShips.set(slot.slotIndex, aiShip);

        const aiCfg = cloneDefaultVsAIConfig();
        aiCfg.aiRace = resolveRaceSelection(slot.race ?? 'terran', matchStart.seed + slot.slotIndex * 0.37);
        // Map AIDifficulty → VsAIConfig difficulty.
        switch (slot.aiDifficulty) {
          case 'easy':      aiCfg.difficulty = 'Easy';      break;
          case 'hard':      aiCfg.difficulty = 'Hard';      break;
          case 'nightmare': aiCfg.difficulty = 'Nightmare'; break;
          default:          aiCfg.difficulty = 'Normal';    break;
        }
        const director = new VsAIDirector(aiShip, aiCfg);
        this.lanAiDirectors.push(director);
      }
    }

    // Command post for the local player.
    const cpPos = new Vec2(playerStart.x, playerStart.y + 80);
    const cp = new CommandPost(cpPos, myTeam);
    if (myFaction === 'synonymous') cp.synonymousVisualKind = 'base';
    this.state.addEntity(cp);
    this.state.setFaction(myTeam, myFaction);
    this.state.ensureConfluenceSeedCircle(myTeam, cpPos);
    this.state.ensureSynonymousSeedSwarm(myTeam, cpPos);

    if (!isConfluenceFaction(this.state.factionByTeam, myTeam) && !isSynonymousFaction(this.state.factionByTeam, myTeam)) {
      const startCx = Math.floor(cpPos.x / GRID_CELL_SIZE);
      const startCy = Math.floor(cpPos.y / GRID_CELL_SIZE);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= 2) {
            this.state.grid.addConduit(startCx + dx, startCy + dy, myTeam);
          }
        }
      }
    }
    this.state.power.markDirty();
    this.state.resources = 500;

    // Wire up LAN callbacks.
    if (this.lanClient) {
      if (isHost) {
        // Host receives remote player inputs and applies them to remote ships.
        this.lanClient.onRelayedInput = (msg: MsgRelayedInput) => {
          this.lanRemoteInputs.set(msg.fromSlot, {
            dx: msg.input.dx,
            dy: msg.input.dy,
            aimX: msg.input.aimX,
            aimY: msg.input.aimY,
            firePrimary: msg.input.firePrimary,
            fireSpecial: msg.input.fireSpecial,
            boost: msg.input.boost,
          });
          // Track the latest seq seen from this slot for prediction replay.
          const prevSeq = this.lanLastProcessedSeqPerSlot.get(msg.fromSlot) ?? -1;
          if (msg.input.seq > prevSeq) {
            this.lanLastProcessedSeqPerSlot.set(msg.fromSlot, msg.input.seq);
          }
        };
      } else {
        // Remote client receives authoritative snapshots from the host.
        this.lanClient.onGameSnapshot = (snapshot) => {
          this.lanLastSnapshotSeq = snapshot.seq;
          this.applyLanSnapshot(snapshot);
        };
      }

      this.lanClient.onMatchEnd = (reason) => {
        this.hud.showMessage(`Match ended: ${reason}`, Colors.alert1, 5);
        this.phase = 'menu';
        this.mainMenu.openTitle();
        Audio.stopDriveLoop();
        Audio.stopMusic();
        Audio.playMenuMusic();
        this.lanClient = null;
        this.lanAiDirectors = [];
      };
    }

    this.phase = 'playing';
    this.mainMenu.close();
    Audio.stopDriveLoop();
    Audio.stopMusic();
    Audio.startPlaylist();

    const aiCount = matchStart.lobby.slots.filter(s => s.type === 'ai').length;
    this.hud.showMessage(
      `LAN ${isHost ? 'Host' : 'Client'} — slot ${this.lanMySlot + 1}` +
        (isHost && aiCount > 0 ? ` | ${aiCount} AI slot${aiCount > 1 ? 's' : ''}` : ''),
      Colors.radar_friendly_status, 4,
    );
  }

  // -----------------------------------------------------------------------
  // Online (WebRTC) match startup & networking
  // -----------------------------------------------------------------------

  /**
   * Begin an online match using a WebRTC transport.
   * Reuses the same game state setup as startLanGame but wires the
   * transport callbacks instead of LAN client callbacks.
   */
  private startOnlineGame(
    transport: WebRtcTransport,
    matchStart: MsgMatchStart,
    isHost: boolean,
  ): void {
    this.onlineTransport = transport;
    this.lanClient = null;
    this.lanMySlot = matchStart.mySlot;
    this.lanRemoteInputs.clear();
    this.lanAiDirectors = [];
    this.lanSnapshotSeq = 0;
    this.lanInputSeq = 0;
    this.lanLastSnapshotSeq = -1;
    this.lanPredictionOffset = { x: 0, y: 0 };
    this.lanPredictionOffsetAlpha = 0;
    this.lanUnacknowledgedInputs = [];
    this.lanLastProcessedSeqPerSlot.clear();

    const myTeam = teamForSlot(this.lanMySlot);
    const playerStart = new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);

    this.state = new GameState(playerStart);
    this.state.gameMode = isHost ? 'online_host' : 'online_client';

    for (const slot of matchStart.lobby.slots) {
      if (slot.type === 'open' || slot.type === 'closed') continue;
      this.state.setFaction(
        teamForSlot(slot.slotIndex),
        resolveRaceSelection(slot.race ?? 'terran', matchStart.seed + slot.slotIndex * 0.37),
      );
    }

    this.applyVisualQuality(this.visualQuality);
    this.vsAIDirector = null;
    this.playerDeathHandled = false;
    this.playerRespawnTimer = 0;
    this.activeGuidedMissile = null;
    this.damageFlashTimer = 0;
    this.playerPrevHealth = -1;
    this.territoryPulseTime = 0;
    this.camera = new Camera();
    this.camera.setScreenSize(this.screenW, this.screenH);
    this.camera.position = playerStart.clone();
    this.actionMenu = new ActionMenu();
    this.hud = new HUD();
    this.waypointMarkers.clear();
    this.spaceFluid.reset();
    this.spaceFluid.resize(this.screenW, this.screenH);

    // Local player ship.
    const myFaction = resolveRaceSelection(
      matchStart.lobby.slots.find((s) => s.slotIndex === this.lanMySlot)?.race ?? 'terran',
      matchStart.seed + this.lanMySlot * 0.37,
    );
    void myFaction; // set via setFaction above
    this.state.playerShips.set(this.lanMySlot, new PlayerShip(playerStart, myTeam));
    if (this.lanMySlot !== 0) {
      this.state.playerShips.set(0, this.state.playerShips.get(this.lanMySlot)!);
    }

    // Placeholder ships for other human slots.
    for (const slot of matchStart.lobby.slots) {
      if (slot.type === 'human' && slot.slotIndex !== this.lanMySlot) {
        this.state.playerShips.set(
          slot.slotIndex,
          new PlayerShip(playerStart.clone(), teamForSlot(slot.slotIndex)),
        );
      }
    }

    // Wire transport callbacks.
    if (isHost) {
      transport.onInputSnapshot = (fromSlot: number, input: NetInputSnapshot) => {
        this.lanRemoteInputs.set(fromSlot, {
          dx: input.dx,
          dy: input.dy,
          aimX: input.aimX,
          aimY: input.aimY,
          firePrimary: input.firePrimary,
          fireSpecial: input.fireSpecial ?? false,
          boost: input.boost,
        });
        const prevSeq = this.lanLastProcessedSeqPerSlot.get(fromSlot) ?? -1;
        if (input.seq > prevSeq) {
          this.lanLastProcessedSeqPerSlot.set(fromSlot, input.seq);
        }
      };
    } else {
      transport.onAuthoritativeSnapshot = (snapshot: NetGameSnapshot) => {
        this.lanLastSnapshotSeq = snapshot.seq;
        // NetGameSnapshot is structurally compatible with applyLanSnapshot's
        // parameter (same field names and shapes for all used fields).
        this.applyLanSnapshot(snapshot as unknown as Parameters<typeof this.applyLanSnapshot>[0]);
      };
    }

    transport.onDisconnect = (reason: string) => {
      this.hud.showMessage(`Disconnected: ${reason}`, Colors.alert1, 5);
      this.phase = 'menu';
      this.mainMenu.openTitle();
      Audio.stopDriveLoop();
      Audio.stopMusic();
      Audio.playMenuMusic();
      this.onlineTransport = null;
    };

    this.phase = 'playing';
    this.mainMenu.close();
    Audio.stopDriveLoop();
    Audio.stopMusic();
    Audio.startPlaylist();

    this.hud.showMessage(
      `Online ${isHost ? 'Host' : 'Client'} — slot ${this.lanMySlot + 1}`,
      Colors.radar_friendly_status, 4,
    );
  }

  /**
   * Online host: broadcast authoritative snapshot to all connected clients via WebRTC.
   * Reuses broadcastLanSnapshot's serialisation logic but sends through the transport.
   */
  private broadcastOnlineSnapshot(): void {
    if (!this.onlineTransport) return;
    const data = this.buildGameSnapshotData();
    this.onlineTransport.sendAuthoritativeSnapshot({
      seq: data.seq,
      serverTimeMs: Date.now(),
      gameTime: data.gameTime,
      ships: data.ships,
      buildings: data.buildings,
      fighters: data.fighters,
      projectiles: data.projectiles,
      resourcesPerSlot: data.resourcesPerSlot,
      hostSlot: data.hostSlot,
      factionsByTeam: data.factionsByTeam,
      territoryCircles: data.territoryCircles,
      lastProcessedInputSeqBySlot: data.lastProcessedInputSeqBySlot,
    });
  }

  /**
   * Online client: send local input to the host via WebRTC.
   */
  private sendOnlineInput(): void {
    if (!this.onlineTransport?.connected) return;
    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    const seq = this.lanInputSeq++;
    const dx = ((Input.isDown('d') ? 1 : 0) - (Input.isDown('a') ? 1 : 0)) as -1 | 0 | 1;
    const dy = ((Input.isDown('s') ? 1 : 0) - (Input.isDown('w') ? 1 : 0)) as -1 | 0 | 1;
    const boost = Input.isDown('Shift');

    const input: NetInputSnapshot = {
      protocolVersion: 1,
      seq,
      clientTimeMs: Date.now(),
      dx,
      dy,
      aimX: aimWorld.x,
      aimY: aimWorld.y,
      firePrimary: Input.mouseDown,
      fireSpecial: Input.mouse2Down,
      boost,
    };

    this.onlineTransport.sendInputSnapshot(input);

    // Buffer for prediction replay.
    this.lanUnacknowledgedInputs.push({ seq, dx, dy, aimX: aimWorld.x, aimY: aimWorld.y, boost });
    if (this.lanUnacknowledgedInputs.length > Game.LAN_INPUT_RING_MAX) {
      this.lanUnacknowledgedInputs.shift();
    }
  }

  /**
   * Apply a relayed game snapshot to non-authoritative client state.
   *
   * Ships:
   *   - Remote ships: directly write position/velocity.
   *   - Local ship (our slot): apply soft prediction correction — blend toward
   *     host authoritative position rather than snapping, unless the error is
   *     large enough that smoothing would look wrong.
   *
   * Fighters:
   *   - Update position/velocity for existing fighters matched by id.
   *   - Create lightweight placeholder FighterShip/BomberShip for new ones.
   *   - Destroy fighters whose ids are absent from the snapshot.
   *
   * Projectiles:
   *   - Update position/velocity for existing projectiles matched by id.
   *   - Projectiles absent from the snapshot are allowed to expire naturally
   *     (they have short lifetimes; removing them immediately could cause
   *     visual pops). New projectiles are not created from snapshots on the
   *     client to avoid duplicating damage effects.
   *
   * Buildings: sync health/buildProgress for known buildings; create new ones if absent.
   * Factions, territory circles, resources: applied directly.
   */
  private applyLanSnapshot(snapshot: {
    seq: number;
    ships: SerializedShip[];
    buildings: SerializedBuilding[];
    fighters: SerializedFighter[];
    projectiles: SerializedProjectile[];
    factionsByTeam?: Array<{ team: number; faction: FactionType }>;
    territoryCircles?: SerializedTerritoryCircle[];
    resourcesPerSlot: number[];
    lastProcessedInputSeqBySlot?: number[];
  }): void {
    // --- Ships ---
    for (const sd of snapshot.ships) {
      if (sd.slotIndex === this.lanMySlot) {
        // Local ship prediction correction + replay:
        // The host has simulated our ship (with our delayed inputs) and is
        // telling us where it thinks we are. Apply a correction toward the host's
        // authoritative position, then replay any inputs not yet acknowledged.
        const localShip = this.state.playerShips.get(sd.slotIndex);
        if (localShip && localShip.alive && sd.alive) {
          const lastAck = snapshot.lastProcessedInputSeqBySlot?.[this.lanMySlot] ?? -1;

          // Prune acknowledged inputs from the ring buffer.
          this.lanUnacknowledgedInputs = this.lanUnacknowledgedInputs.filter(
            (i) => i.seq > lastAck,
          );

          const errX = sd.x - localShip.position.x;
          const errY = sd.y - localShip.position.y;
          const errDist = Math.hypot(errX, errY);
          if (errDist > Game.LAN_PREDICTION_SNAP_THRESHOLD) {
            // Large error — snap immediately to host position and velocity.
            localShip.position.x = sd.x;
            localShip.position.y = sd.y;
            localShip.velocity.x = sd.vx;
            localShip.velocity.y = sd.vy;
            this.lanPredictionOffset = { x: 0, y: 0 };
            this.lanPredictionOffsetAlpha = 0;
          } else {
            // Set authoritative base state, then replay unacknowledged inputs
            // so the local position reflects inputs the host has not yet seen.
            localShip.position.x = sd.x;
            localShip.position.y = sd.y;
            localShip.velocity.x = sd.vx;
            localShip.velocity.y = sd.vy;
            for (const inp of this.lanUnacknowledgedInputs) {
              const len = Math.hypot(inp.dx, inp.dy);
              if (len > 0.01) {
                const ux = inp.dx / len;
                const uy = inp.dy / len;
                localShip.velocity.x += ux * localShip.thrustPower * DT;
                localShip.velocity.y += uy * localShip.thrustPower * DT;
                localShip.position.x += localShip.velocity.x * DT;
                localShip.position.y += localShip.velocity.y * DT;
              }
            }
            if (errDist > Game.LAN_PREDICTION_MIN_BLEND_THRESHOLD) {
              // Residual visual offset: blend remaining error out smoothly.
              this.lanPredictionOffset.x += errX;
              this.lanPredictionOffset.y += errY;
              this.lanPredictionOffsetAlpha = Math.min(
                1,
                this.lanPredictionOffsetAlpha + Game.LAN_PREDICTION_ALPHA_INCREMENT,
              );
            }
          }
          // Sync health/battery regardless of position correction.
          localShip.health = sd.health;
          localShip.battery = sd.battery;
          if (!sd.alive) localShip.destroy();
        }
        continue;
      }

      let ship = this.state.playerShips.get(sd.slotIndex);
      if (!ship) {
        // Lazily create remote ship on first snapshot.
        ship = new PlayerShip(new Vec2(sd.x, sd.y), teamForSlot(sd.slotIndex));
        this.state.playerShips.set(sd.slotIndex, ship);
      }
      ship.position.x = sd.x;
      ship.position.y = sd.y;
      ship.velocity.x = sd.vx;
      ship.velocity.y = sd.vy;
      ship.angle = sd.angle;
      ship.health = sd.health;
      ship.battery = sd.battery;
      if (!sd.alive && ship.alive) ship.destroy();
    }

    // --- Buildings ---
    // Build a lookup map for fast id-based matching.
    const buildingById = new Map<number, BuildingBase>();
    for (const b of this.state.buildings) buildingById.set(b.id, b);

    for (const sb of snapshot.buildings) {
      const b = buildingById.get(sb.id);
      if (b) {
        // Update existing building.
        b.health = sb.health;
        b.buildProgress = sb.buildProgress;
        b.powered = sb.powered;
        if (!sb.alive && b.alive) b.destroy();
      } else if (sb.alive) {
        // Building not known locally — create it from snapshot so remote clients
        // can see buildings placed after match start.
        const def = buildDefForEntityType(sb.entityType as EntityType);
        if (def) {
          const newBuilding = createBuildingFromDef(def, new Vec2(sb.x, sb.y), sb.team as Team);
          // Force id to match host's authoritative id so future snapshots find it.
          (newBuilding as unknown as { id: number }).id = sb.id;
          newBuilding.health = sb.health;
          newBuilding.buildProgress = sb.buildProgress;
          newBuilding.powered = sb.powered;
          this.state.addEntity(newBuilding);
          this.state.power.markDirty();
        }
      }
    }
    // Remove buildings on this client that the host no longer reports.
    // (Destroyed by host — not included in snapshot at all.)
    const snapshotBuildingIds = new Set(snapshot.buildings.map((sb) => sb.id));
    for (const b of this.state.buildings) {
      if (b.alive && !snapshotBuildingIds.has(b.id)) {
        b.destroy();
      }
    }

    // --- Fighters ---
    // Build a set of ids present in the snapshot for quick membership tests.
    const snapshotFighterIds = new Set<number>();
    const snapshotFighterById = new Map<number, SerializedFighter>();
    for (const sf of snapshot.fighters) {
      snapshotFighterIds.add(sf.id);
      snapshotFighterById.set(sf.id, sf);
    }

    // Update or remove existing client-side fighters.
    for (const f of this.state.fighters) {
      if (!f.alive) continue;
      const sf = snapshotFighterById.get(f.id);
      if (sf) {
        // Update position/velocity from snapshot.
        f.position.x = sf.x;
        f.position.y = sf.y;
        f.velocity.x = sf.vx;
        f.velocity.y = sf.vy;
        f.angle = sf.angle;
        if (!sf.alive && f.alive) f.destroy();
      } else {
        // Fighter has been removed from host state (dead/docked) — destroy locally.
        if (f.alive) f.destroy();
      }
    }

    // Create placeholder fighters for ids that don't exist locally.
    const existingFighterIds = new Set(this.state.fighters.map((f) => f.id));
    for (const sf of snapshot.fighters) {
      if (existingFighterIds.has(sf.id) || !sf.alive) continue;
      const isBomber = sf.entityType === EntityType.Bomber;
      const newFighter = isBomber
        ? new BomberShip(new Vec2(sf.x, sf.y), sf.team as Team, ShipGroup.Red, null)
        : new FighterShip(new Vec2(sf.x, sf.y), sf.team as Team, ShipGroup.Red, null);
      // Force the id to match the host's id so future snapshots can find it.
      (newFighter as unknown as { id: number }).id = sf.id;
      newFighter.velocity.x = sf.vx;
      newFighter.velocity.y = sf.vy;
      newFighter.angle = sf.angle;
      newFighter.docked = false;
      this.state.addEntity(newFighter);
    }

    // --- Projectiles ---
    // Only update position/velocity of existing projectiles.
    // New projectiles are NOT created from snapshots to avoid duplicating
    // collision/damage effects that the host simulation already owns.
    // Projectiles that vanish from snapshots are left to expire naturally.
    const snapshotProjectileById = new Map<number, SerializedProjectile>();
    for (const sp of snapshot.projectiles) snapshotProjectileById.set(sp.id, sp);

    for (const p of this.state.projectiles) {
      if (!p.alive) continue;
      const sp = snapshotProjectileById.get(p.id);
      if (sp) {
        // Nudge position toward host state (interpolation rather than snap).
        p.position.x += (sp.x - p.position.x) * Game.LAN_PROJECTILE_POSITION_BLEND;
        p.position.y += (sp.y - p.position.y) * Game.LAN_PROJECTILE_POSITION_BLEND;
        p.velocity.x = sp.vx;
        p.velocity.y = sp.vy;
      }
    }

    if (Array.isArray(snapshot.factionsByTeam)) {
      this.state.factionByTeam.clear();
      for (const f of snapshot.factionsByTeam) this.state.factionByTeam.set(f.team as Team, f.faction);
    }
    if (Array.isArray(snapshot.territoryCircles)) {
      this.state.territoryCirclesByTeam.clear();
      for (const c of snapshot.territoryCircles) {
        const arr = this.state.territoryCirclesByTeam.get(c.team as Team) ?? [];
        arr.push({ ...c });
        this.state.territoryCirclesByTeam.set(c.team as Team, arr);
      }
    }
    // --- Resources per slot ---
    if (Array.isArray(snapshot.resourcesPerSlot)) {
      const myRes = snapshot.resourcesPerSlot[this.lanMySlot];
      if (typeof myRes === 'number') this.state.resources = myRes;
    }
  }

  /**
   * Broadcast the authoritative game state snapshot to the server for
   * relay to all remote clients. Called by the host at SNAPSHOT_INTERVAL.
   * Includes ships, buildings, fighters, projectiles, and resources per slot.
   */
  /**
   * Build the game snapshot data object. Used by both LAN and online transports.
   * Returns an object with the serialized game state for broadcasting to clients.
   */
  private buildGameSnapshotData(): {
    seq: number;
    gameTime: number;
    ships: SerializedShip[];
    buildings: SerializedBuilding[];
    fighters: SerializedFighter[];
    projectiles: SerializedProjectile[];
    resourcesPerSlot: number[];
    hostSlot: number;
    factionsByTeam: Array<{ team: number; faction: string }>;
    territoryCircles: SerializedTerritoryCircle[];
    lastProcessedInputSeqBySlot: number[] | undefined;
  } {
    // --- Ships ---
    const ships: SerializedShip[] = [];
    for (const [slot, ship] of this.state.playerShips) {
      ships.push({
        slotIndex: slot,
        x: ship.position.x,
        y: ship.position.y,
        vx: ship.velocity.x,
        vy: ship.velocity.y,
        angle: ship.angle,
        health: ship.health,
        maxHealth: ship.maxHealth,
        battery: ship.battery,
        shield: ship.shield,
        alive: ship.alive,
      });
    }

    // --- Buildings ---
    const buildings: SerializedBuilding[] = [];
    const factionsByTeam = Array.from(this.state.factionByTeam.entries()).map(([team, faction]) => ({ team, faction }));
    const territoryCircles: SerializedTerritoryCircle[] = [];
    for (const [team, circles] of this.state.territoryCirclesByTeam.entries()) {
      for (const c of circles) territoryCircles.push({ ...c, team });
    }
    for (const b of this.state.buildings) {
      if (!b.alive) continue;
      buildings.push({
        id: b.id,
        entityType: b.type,
        team: b.team,
        x: b.position.x,
        y: b.position.y,
        health: b.health,
        maxHealth: b.maxHealth,
        buildProgress: b.buildProgress,
        powered: b.powered,
        alive: b.alive,
      });
    }

    // --- Fighters (only alive, undocked fighters to keep snapshot small) ---
    const fighters: SerializedFighter[] = [];
    for (const f of this.state.fighters) {
      if (!f.alive || f.docked) continue;
      fighters.push({
        id: f.id,
        entityType: f.type,
        team: f.team,
        x: f.position.x,
        y: f.position.y,
        vx: f.velocity.x,
        vy: f.velocity.y,
        angle: f.angle,
        alive: f.alive,
      });
    }

    // --- Projectiles ---
    const projectiles: SerializedProjectile[] = [];
    for (const p of this.state.projectiles) {
      if (!p.alive) continue;
      projectiles.push({
        id: p.id,
        entityType: p.type,
        team: p.team,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        angle: p.angle,
      });
    }

    // Resources indexed by slot (sparse, sized to MAX_SLOTS from protocol).
    const MAX_LAN_SLOTS = 8;
    const resourcesPerSlot: number[] = new Array(MAX_LAN_SLOTS).fill(0);
    resourcesPerSlot[this.lanMySlot] = this.state.resources;

    // Per-slot last processed input seq array for prediction replay.
    let lastProcessedInputSeqBySlot: number[] | undefined;
    if (this.lanLastProcessedSeqPerSlot.size > 0) {
      lastProcessedInputSeqBySlot = [];
      for (const [slot, seq] of this.lanLastProcessedSeqPerSlot) {
        lastProcessedInputSeqBySlot[slot] = seq;
      }
    }

    return {
      seq: this.lanSnapshotSeq++,
      gameTime: this.state.gameTime,
      ships,
      buildings,
      fighters,
      projectiles,
      resourcesPerSlot,
      hostSlot: 0,
      factionsByTeam,
      territoryCircles,
      lastProcessedInputSeqBySlot,
    };
  }

  private broadcastLanSnapshot(): void {
    if (!this.lanClient?.connected) return;
    const data = this.buildGameSnapshotData();
    this.lanClient.sendGameSnapshot({
      ...data,
      factionsByTeam: data.factionsByTeam as Array<{ team: number; faction: import('./lan/protocol.js').FactionType }>,
    });
  }

  private damageLaserLineLimited(start: Vec2, end: Vec2, damage: number, hitRadius: number, pierceCount: number, source: Entity = this.state.player): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return;
    const hits: Array<{ target: Entity; t: number }> = [];
    for (const target of this.state.allEntities()) {
      if (!target.alive || target.team === source.team || target.team === Team.Neutral) continue;
      const tx = target.position.x - start.x;
      const ty = target.position.y - start.y;
      const t = Math.max(0, Math.min(1, (tx * dx + ty * dy) / lenSq));
      const px = start.x + dx * t;
      const py = start.y + dy * t;
      const dist = Math.hypot(target.position.x - px, target.position.y - py);
      if (dist <= target.radius + hitRadius) hits.push({ target, t });
    }
    hits.sort((a, b) => a.t - b.t);
    const count = Math.min(pierceCount, hits.length);
    for (let i = 0; i < count; i++) {
      const target = hits[i].target;
      target.takeDamage(damage, source);
      this.state.recentlyDamaged.add(target.id);
      if (!target.alive) {
        this.state.particles.emitExplosion(target.position, target.radius);
        this.spaceFluid.addExplosion(target.position.x, target.position.y, 0.75, 42, 190, 120);
      } else {
        this.state.particles.emitSpark(target.position);
      }
    }
  }

  /**
   * Send this client's local input to the server (for the host to apply).
   * Called every tick for non-host LAN clients.
   */
  private sendLanInput(): void {
    if (!this.lanClient?.connected) return;
    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    const seq = this.lanInputSeq++;
    const dx = (Input.isDown('d') ? 1 : 0) - (Input.isDown('a') ? 1 : 0);
    const dy = (Input.isDown('s') ? 1 : 0) - (Input.isDown('w') ? 1 : 0);
    const boost = Input.isDown('Shift');

    this.lanClient.sendInputSnapshot({
      seq,
      dx,
      dy,
      aimX: aimWorld.x,
      aimY: aimWorld.y,
      firePrimary: Input.mouseDown,
      fireSpecial: Input.mouse2Down,
      boost,
    });

    // Buffer this input for prediction replay (trimmed to ring size).
    this.lanUnacknowledgedInputs.push({ seq, dx, dy, aimX: aimWorld.x, aimY: aimWorld.y, boost });
    if (this.lanUnacknowledgedInputs.length > Game.LAN_INPUT_RING_MAX) {
      this.lanUnacknowledgedInputs.shift();
    }
  }

  /**
   * Apply buffered remote-player inputs to their corresponding ships.
   * Host-only: called once per tick before GameState.update().
   */
  private applyRemoteLanInputs(): void {
    for (const [slot, inp] of this.lanRemoteInputs) {
      const ship = this.state.playerShips.get(slot);
      if (!ship || !ship.alive) continue;
      // Aim
      ship.setAimPoint(new Vec2(inp.aimX, inp.aimY));
      // Inject virtual thrust as velocity impulse (mirrors PlayerShip.handleInput)
      const len = Math.hypot(inp.dx, inp.dy);
      if (len > 0.01) {
        const ux = inp.dx / len;
        const uy = inp.dy / len;
        ship.velocity = ship.velocity.add(new Vec2(ux * ship.thrustPower * DT, uy * ship.thrustPower * DT));
        ship.thrustDir = new Vec2(ux, uy);
        ship.isThrusting = true;
      } else {
        ship.isThrusting = false;
      }
      // Fire a basic bullet on behalf of the remote player when they press LMB.
      // This keeps firing host-authoritative while giving remote players a weapon.
      if (inp.firePrimary) {
        this.fireRemotePlayerWeapon(ship);
      }
    }
  }

  /**
   * Host fires a basic bullet on behalf of a remote player ship.
   * This is intentionally simple (always fires the base Bullet) to avoid
   * duplicating weapon logic; per-weapon remote firing can be added later.
   */
  private fireRemotePlayerWeapon(ship: PlayerShip): void {
    if (!ship.canFirePrimary()) return;
    const aim = ship.aimWorld;
    const angle = Math.atan2(aim.y - ship.position.y, aim.x - ship.position.x);
    ship.consumePrimaryFire(PLAYER_FIRE_COOLDOWN * ship.fireCooldownMultiplier);
    this.state.addEntity(new Bullet(
      ship.team,
      ship.position.clone(),
      angle,
      ship,
      this.findClosestEnemyForTeam(ship.position, ship.team, 520),
    ));
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const ctx = this.ctx;
    const w = this.screenW;
    const h = this.screenH;
    const dpr = w > 0 ? this.canvas.width / w : (window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = gameFont(12);

    // Clear
    ctx.fillStyle = colorToCSS(Colors.friendly_background);
    ctx.fillRect(0, 0, w, h);

    if (this.phase === 'menu') {
      this.mainMenu.draw(ctx, w, h);
      return;
    }

    this.glowLayer.begin();

    // Draw game world
    this.nebula.draw(ctx, this.camera, w, h);
    this.starfield.draw(ctx, this.camera, w, h);
    // Advance the fluid simulation by the frame delta and draw it under the game world.
    this.spaceFluid.step(this.lastFrameMs);
    this.spaceFluid.render(ctx);
    drawConfluenceTerritory(ctx, this.camera, this.state, this.territoryPulseTime);
    this.state.grid.draw(
      ctx,
      this.camera,
      w,
      h,
      this.state.gameTime,
      (cx, cy, team) => this.state.power.isCellEnergized(team, cx, cy),
      this.visualPreset.conduitShimmer,
    );
    this.state.drawEntities(ctx, this.camera);
    drawWaypointMarkers(ctx, this.camera, this.state, this.waypointMarkers);
    this.drawGlowLayer();
    this.glowLayer.compositeTo(ctx);

    // Edge indicators (always)
    drawEdgeIndicators(ctx, this.camera, this.state, w, h);

    // Full radar overlay (hold Tab)
    if (Input.isDown('Tab')) {
      drawRadarOverlay(ctx, this.state, w, h);
    }

    this.drawScreenOverlays(ctx, w, h);

    // Action menu
    this.actionMenu.draw(ctx, this.state, this.camera, w, h);

    // HUD
    this.hud.draw(ctx, w, h);
    this.hud.drawAIChat(ctx, w, h);
    this.drawBuildingHoverHitpoints(ctx);
    const synonymousPlayer = isSynonymousFaction(this.state.factionByTeam, Team.Player);
    this.hud.drawResources(
      ctx,
      synonymousPlayer ? this.state.synonymous.getUnallocatedCount(Team.Player) : this.state.resources,
      this.state.getPlayerIncomePerSecond(),
      w,
      h,
      synonymousPlayer
        ? { currencySymbol: SYNONYMOUS_CURRENCY_SYMBOL, symbolOnRight: true, symbolFont: 'menu' }
        : undefined,
    );
    if (this.state.player.alive) {
      this.hud.drawPlayerEnergy(
        ctx,
        this.state.player.battery,
        this.state.player.maxBattery,
        this.state.player.health,
        this.state.player.maxHealth,
        w,
        h,
      );
      this.hud.drawResearchStatus(ctx, this.state.researchProgress, this.state.researchedItems.size, h);
      if (!synonymousPlayer) {
        // Count unpowered player buildings, excluding only power sources.
        let unpowered = 0;
        for (const b of this.state.buildings) {
          if (!b.alive || b.team !== Team.Player) continue;
          if (b.buildProgress < 1) continue;
          if (
            b.type === EntityType.CommandPost ||
            b.type === EntityType.PowerGenerator
          ) continue;
          if (!b.powered) unpowered++;
        }
        this.hud.drawPowerStatus(ctx, unpowered, h);
      }
    }

    // Practice / Vs. AI mode HUD
    if ((this.state.gameMode === 'practice' || this.state.gameMode === 'vs_ai')
        && !this.practiceMode.gameOver) {
      this.drawPracticeHUD(ctx, w, h);
    }

    if (this.debugOverlay) {
      drawDebugOverlay(ctx, {
        screenW: w,
        state: this.state,
        lastFrameMs: this.lastFrameMs,
        lanClient: this.lanClient,
        lanMySlot: this.lanMySlot,
        lanLastSnapshotSeq: this.lanLastSnapshotSeq,
        lanSnapshotSeq: this.lanSnapshotSeq,
        lanAiDirectorCount: this.lanAiDirectors.length,
        lanPredictionError: this.lanPredictionOffsetAlpha > 0
          ? Math.hypot(this.lanPredictionOffset.x, this.lanPredictionOffset.y)
          : 0,
      });
    }

    // Pause overlay
    if (this.phase === 'paused') {
      this.mainMenu.draw(ctx, w, h);
    }
  }

  private drawPracticeHUD(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    ctx.font = '12px "Poiret One", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.7);
    ctx.fillText(
      `Bases destroyed: ${this.practiceMode.score.basesDestroyed} | Time: ${Math.floor(this.practiceMode.score.timeSurvived)}s`,
      10, 10,
    );
  }

  private drawBuildingHoverHitpoints(ctx: CanvasRenderingContext2D): void {
    const world = this.camera.screenToWorld(Input.mousePos);
    let hovered: BuildingBase | null = null;
    let bestDist = Infinity;
    for (const b of this.state.buildings) {
      if (!b.alive) continue;
      const half = footprintForBuildingType(b.type) * GRID_CELL_SIZE * 0.5;
      const dx = Math.abs(world.x - b.position.x);
      const dy = Math.abs(world.y - b.position.y);
      if (dx > half || dy > half) continue;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        hovered = b;
        bestDist = d;
      }
    }
    if (!hovered) return;

    const screen = this.camera.worldToScreen(hovered.position);
    const text = `${Math.ceil(hovered.health)}/${Math.ceil(hovered.maxHealth)}`;
    ctx.save();
    ctx.font = 'bold 14px "Poiret One", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const padX = 8;
    const boxW = metrics.width + padX * 2;
    const boxH = 22;
    const x = screen.x;
    const y = screen.y - hovered.radius * this.camera.zoom - 18;
    ctx.fillStyle = colorToCSS(Colors.friendly_background, 0.72);
    ctx.strokeStyle = colorToCSS(hovered.team === Team.Player ? Colors.radar_friendly_status : Colors.enemyfire, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - boxW / 2, y - boxH / 2, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colorToCSS(hovered.team === Team.Enemy ? Colors.enemyfire : Colors.general_building, 0.95);
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  private speedGlowFactor(speed: number, maxSpeed: number): number {
    const normalized = maxSpeed > 0 ? Math.min(1, Math.max(0, speed / maxSpeed)) : 0;
    return 0.1 + normalized * 0.9;
  }

  private playerSpeedFraction(): number {
    const speed = Math.hypot(this.state.player.velocity.x, this.state.player.velocity.y);
    const maxSpeed = this.state.player.maxSpeed * (this.state.player.isBoosting ? 1.8 : 1);
    return maxSpeed > 0 ? Math.min(1, Math.max(0, speed / maxSpeed)) : 0;
  }

  private fighterMaxSpeed(fighter: FighterShip): number {
    return fighter instanceof BomberShip || fighter instanceof SynonymousNovaBomberShip
      ? SHIP_STATS.bomber.speed
      : SHIP_STATS.fighter.speed;
  }

  private drawGlowLayer(): void {
    if (!this.visualPreset.glowEnabled) return;
    const glow = this.glowLayer;
    for (const fire of this.state.explosionGlows) {
      if (!this.camera.isOnScreen(fire.center, fire.radius * 1.7)) continue;
      const t = 1 - fire.lifeSeconds / fire.totalSeconds;
      const fade = Math.max(0, 1 - t);
      const bloom = fire.intensity * fade;
      glow.circleWorld(this.camera, fire.center, fire.radius * 1.45, Colors.alert1, 0.10 * bloom);
      glow.circleWorld(this.camera, fire.center, fire.radius * 1.08, Colors.explosion, 0.20 * bloom);
      glow.circleWorld(this.camera, fire.center, fire.radius * 0.48, Colors.alert2, 0.24 * bloom);
      glow.circleWorld(this.camera, fire.center, Math.max(10, fire.radius * 0.18), Colors.particles_switch, 0.20 * bloom);
    }

    for (const p of this.state.projectiles) {
      if (!p.alive || !this.camera.isOnScreen(p.position, 180)) continue;
      if (p instanceof Laser || p instanceof ChargedLaserBurst) {
        const target = p.targetPos;
        const color = p.team === Team.Player ? Colors.friendlyfire : Colors.enemyfire;
        const alpha = p instanceof ChargedLaserBurst ? 0.34 + p.chargeFraction * 0.2 : 0.22;
        const width = p instanceof ChargedLaserBurst ? 18 + p.chargeFraction * 22 : 10;
        glow.lineWorld(this.camera, p.position, target, color, alpha, width);
        glow.circleWorld(this.camera, target, p instanceof ChargedLaserBurst ? 18 : 8, Colors.particles_switch, alpha * 0.65);
      } else if (p instanceof GuidedMissile || p instanceof BomberMissile || p instanceof SwarmMissile) {
        const blastRadius = 'blastRadius' in p ? (p as { blastRadius: number }).blastRadius : 0;
        if (blastRadius > 0) {
          glow.circleWorld(this.camera, p.position, Math.min(34, blastRadius * 0.24), Colors.explosion, 0.10);
          glow.circleWorld(this.camera, p.position, Math.min(18, blastRadius * 0.12), Colors.alert2, 0.12);
        }
        const exhaust = p.position.add(new Vec2(Math.cos(p.angle + Math.PI) * p.radius, Math.sin(p.angle + Math.PI) * p.radius));
        glow.circleWorld(this.camera, exhaust, p.radius * 2.4, Colors.alert2, 0.18);
        glow.circleWorld(this.camera, exhaust, p.radius * 4.2, Colors.explosion, 0.08);
      } else {
        const blastRadius = 'blastRadius' in p ? (p as { blastRadius: number }).blastRadius : 0;
        if (blastRadius > 0) {
          glow.circleWorld(this.camera, p.position, Math.min(40, blastRadius * 0.32), Colors.explosion, 0.12);
          glow.circleWorld(this.camera, p.position, Math.min(20, blastRadius * 0.16), Colors.alert2, 0.14);
        }
      }
    }

    for (const b of this.state.buildings) {
      if (!b.alive || b.buildProgress < 1 || !this.camera.isOnScreen(b.position, 180)) continue;
      const powered = b.type === EntityType.CommandPost || b.type === EntityType.PowerGenerator || b.powered;
      if (!powered) continue;
      const friendly = b.team === Team.Player;
      const color = friendly ? Colors.radar_friendly_status : Colors.enemyfire;
      const pulse = 0.75 + 0.25 * Math.sin(this.state.gameTime * 2.2 + b.id * 0.37);
      glow.circleWorld(this.camera, b.position, b.radius * 1.9, color, 0.035 * pulse);
      if (
        b.type === EntityType.MissileTurret ||
        b.type === EntityType.TimeBomb ||
        b.type === EntityType.ExciterTurret ||
        b.type === EntityType.MassDriverTurret ||
        b.type === EntityType.RegenTurret ||
        b.type === EntityType.RepairTurret
      ) {
        glow.circleWorld(this.camera, b.position, b.radius * 1.25, color, 0.045 * pulse, false, 2);
      }
    }

    for (const ship of this.state.playerShips.values()) {
      if (!ship.alive || !this.camera.isOnScreen(ship.position, 220)) continue;
      const r = ship.radius;
      if (ship.isBoosting || ship.gatlingOverdriveTimer > 0) {
        glow.circleWorld(this.camera, ship.position, r * 2.9, Colors.alert2, 0.11);
      }
      if (ship.gatlingOverheatTimer > 0) {
        glow.circleWorld(this.camera, ship.position, r * 3.1, Colors.alert1, 0.12);
      }
      if (ship.shieldUnlocked && ship.shield > 0) {
        glow.circleWorld(this.camera, ship.position, r * 1.8, Colors.radar_allied_status, 0.10, false, 5);
      }
      // Engine exhaust glow: speed controls both size and opacity.
      if (this.visualPreset.engineGlow) {
        const speedFactor = this.speedGlowFactor(Math.hypot(ship.velocity.x, ship.velocity.y), ship.maxSpeed * 1.8);
        const exhaustColor = ship.team === Team.Player ? Colors.particles_friendly_exhaust : Colors.particles_enemy_exhaust;
        const exhaustAlpha = (ship.isBoosting ? 0.22 : 0.14) * speedFactor;
        glow.circleWorld(this.camera, ship.position, r * 2.4 * speedFactor, exhaustColor, exhaustAlpha);
        glow.circleWorld(this.camera, ship.position, r * 1.1, Colors.particles_switch, exhaustAlpha * 0.4);
      }
    }

    // Fighter engine glow — a soft colored bloom behind each airborne fighter.
    if (this.visualPreset.engineGlow) {
      for (const f of this.state.fighters) {
        if (!f.alive || f.docked || !this.camera.isOnScreen(f.position, 60)) continue;
        const r = f.radius;
        const exhaustColor = f.team === Team.Player ? Colors.particles_friendly_exhaust : Colors.particles_enemy_exhaust;
        const speed = Math.hypot(f.velocity.x, f.velocity.y);
        const speedFactor = this.speedGlowFactor(speed, this.fighterMaxSpeed(f));
        glow.circleWorld(this.camera, f.position, r * 2.8 * speedFactor, exhaustColor, 0.14 * speedFactor);
      }
    }

    // Bullet glow — ramps up with projectile age and keeps screen conversion work low.
    if (this.visualPreset.bulletGlow) {
      for (const p of this.state.projectiles) {
        if (!p.alive || !this.camera.isOnScreen(p.position, 26)) continue;
        if (p instanceof Laser || p instanceof ChargedLaserBurst) continue; // already handled above
        if (p instanceof GuidedMissile || p instanceof BomberMissile || p instanceof SwarmMissile) continue; // handled above
        const lifeProgress = p.maxLifetime > 0 ? Math.min(1, Math.max(0, 1 - p.lifetime / p.maxLifetime)) : 1;
        if (lifeProgress <= 0.02) continue;
        const bulletColor = p.team === Team.Player ? Colors.friendlyfire : Colors.enemyfire;
        const speed = Math.hypot(p.velocity.x, p.velocity.y);
        const speedFactor = Math.min(1, speed / 520);
        const screen = this.camera.worldToScreen(p.position);
        const zoom = this.camera.zoom;
        const glowFactor = lifeProgress * lifeProgress;
        const trailLen = p.radius * (7.5 + speedFactor * 7.5) * zoom * glowFactor;
        const tail = new Vec2(
          screen.x - Math.cos(p.angle) * trailLen,
          screen.y - Math.sin(p.angle) * trailLen,
        );
        // Additive line bloom acts like a tiny post-process streak without per-pixel shaders.
        glow.lineScreen(tail, screen, bulletColor, (0.045 + speedFactor * 0.06) * glowFactor, p.radius * (2.8 + speedFactor * 1.5) * zoom * glowFactor);
        glow.circleScreen(screen, p.radius * (5.2 + speedFactor * 1.6) * zoom * glowFactor, bulletColor, (0.055 + speedFactor * 0.03) * glowFactor);
        glow.circleScreen(screen, p.radius * (2.1 + speedFactor * 0.4) * zoom * glowFactor, Colors.particles_switch, 0.06 * glowFactor);
      }
    }
  }


  private drawScreenOverlays(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.overlayW !== w || this.overlayH !== h || !this.vignetteGradient) {
      this.overlayW = w;
      this.overlayH = h;
      const cx = w * 0.5;
      const cy = h * 0.5;
      const outerR = Math.hypot(cx, cy);
      this.vignetteGradient = ctx.createRadialGradient(cx, cy, outerR * 0.54, cx, cy, outerR);
      this.vignetteGradient.addColorStop(0.0, 'rgba(0,0,0,0)');
      this.vignetteGradient.addColorStop(1.0, 'rgba(0,0,0,0.42)');

      // Flash gradient — cached at full alpha; actual alpha applied via globalAlpha.
      this.flashGradient = ctx.createRadialGradient(cx, cy, outerR * 0.35, cx, cy, outerR * 1.05);
      this.flashGradient.addColorStop(0, 'rgba(255,0,0,0)');
      this.flashGradient.addColorStop(1, 'rgba(255,0,0,1)');

      // Color-fringe gradients — cached since they are static strips.
      const fringeW = Math.round(w * 0.12);
      this.fringeGradientL = ctx.createLinearGradient(0, 0, fringeW, 0);
      this.fringeGradientL.addColorStop(0, 'rgba(255,30,0,0.055)');
      this.fringeGradientL.addColorStop(1, 'rgba(255,30,0,0)');
      this.fringeGradientR = ctx.createLinearGradient(w, 0, w - fringeW, 0);
      this.fringeGradientR.addColorStop(0, 'rgba(0,60,255,0.045)');
      this.fringeGradientR.addColorStop(1, 'rgba(0,60,255,0)');
    }

    const territory = Math.max(-1, Math.min(1, this.camera.position.x / (WORLD_WIDTH * 0.42)));
    ctx.save();
    ctx.fillStyle = territory >= 0
      ? `rgba(255,70,34,${0.018 + territory * 0.022})`
      : `rgba(50,190,210,${0.018 + -territory * 0.018})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.vignetteGradient!;
    ctx.fillRect(0, 0, w, h);

    // Damage flash — red vignette that fades quickly after the player is hit.
    if (this.damageFlashTimer > 0 && this.flashGradient) {
      const flashAlpha = Math.min(1, this.damageFlashTimer / 0.35) * 0.38;
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = this.flashGradient;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Color fringe — subtle lens-distortion color split at the screen edges.
    // Two linear gradient strips (left edge → red, right edge → blue) at very
    // low opacity give a CRT-style chromatic-aberration impression.
    if (this.visualPreset.colorFringe && this.fringeGradientL && this.fringeGradientR) {
      const fringeW = Math.round(w * 0.12);
      ctx.fillStyle = this.fringeGradientL;
      ctx.fillRect(0, 0, fringeW, h);
      ctx.fillStyle = this.fringeGradientR;
      ctx.fillRect(w - fringeW, 0, fringeW, h);
    }

    if (this.visualPreset.scanlines) {
      if (!this.scanlinePattern) {
        const p = document.createElement('canvas');
        p.width = 1;
        p.height = 4;
        const pctx = p.getContext('2d')!;
        pctx.fillStyle = 'rgba(255,255,255,0.035)';
        pctx.fillRect(0, 0, 1, 1);
        this.scanlinePattern = ctx.createPattern(p, 'repeat');
      }
      if (this.scanlinePattern) {
        ctx.fillStyle = this.scanlinePattern;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.restore();
  }

}
