/** Main game coordinator for Gate88 */

import { Vec2 } from './math.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Camera } from './camera.js';
import { GameState } from './gamestate.js';
import { Starfield } from './starfield.js';
import { Nebula } from './nebula.js';
import { drawEdgeIndicators, drawRadarOverlay } from './radar.js';
import { ActionMenu, MenuResult, researchDisplayName } from './actionmenu.js';
import { HUD } from './hud.js';
import { MainMenu, MenuAction } from './menu.js';
import { Colors, colorToCSS } from './colors.js';
import { Team, EntityType, ShipGroup, Entity } from './entities.js';
import { DT, WORLD_WIDTH, WORLD_HEIGHT, RESEARCH_COST, RESEARCH_TIME, TICK_RATE, WEAPON_STATS, ACTIVE_RESEARCH_ITEMS, SHIP_STATS } from './constants.js';
import { BuildingBase, CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { TurretBase } from './turret.js';
import { FighterShip, BomberShip, SynonymousFighterShip, SynonymousNovaBomberShip } from './fighter.js';
import { Bullet } from './projectile.js';
import { GuidedMissile } from './projectile.js';
import { PracticeMode } from './practicemode.js';
import { cloneDefaultPracticeConfig } from './practiceconfig.js';
import { TutorialMode } from './tutorial.js';
import { AIShip, VsAIDirector } from './vsaibot.js';
import { PlayerShip } from './ship.js';
import { isHostile, isPlayableTeam, teamForSlot } from './teamutils.js';
import { worldToCell, footprintCenter, GRID_CELL_SIZE } from './grid.js';
import { footprintForBuildingType } from './buildingfootprint.js';
import { gameFont } from './fonts.js';
import { createSpaceFluid, SpaceFluid } from './spacefluid.js';
import type { LanClient } from './lan/lanClient.js';
import type { MsgMatchStart, MsgRelayedInput, SerializedShip, SerializedBuilding, SerializedFighter, SerializedProjectile, SerializedTerritoryCircle } from './lan/protocol.js';
import { createBuildingFromDef, getBuildDef, buildDefForEntityType } from './builddefs.js';
import { isConfluenceFaction, isSynonymousFaction, resolveRaceSelection, type FactionType, CONFLUENCE_PLACEMENT_DISTANCE, CONFLUENCE_PLACEMENT_TOLERANCE, CONFLUENCE_BASE_RADIUS } from './confluence.js';
import { SYNONYMOUS_BUILD_COST, SYNONYMOUS_CURRENCY_SYMBOL } from './synonymous.js';
import { cloneDefaultVsAIConfig, rankedDifficultyName, VSAI_RANKED_SCORE_KEY } from './vsaiconfig.js';
import { GlowLayer } from './glowlayer.js';
import { DEFAULT_VISUAL_QUALITY, VISUAL_QUALITY_PRESETS, type VisualQuality, type VisualQualityPreset, loadVisualQuality, saveVisualQuality } from './visualquality.js';
import { drawCombatTargetingDebug, drawConfluenceTerritory, drawDebugOverlay, drawWaypointMarkers, type ShipCommandGroup, type WaypointMarker } from './gameRender.js';
import { renderBudget } from './renderBudget.js';
import type { NetInputSnapshot, NetGameSnapshot } from './net/protocol.js';
import type { WebRtcTransport } from './online/webrtcTransport.js';
import { findClosestEnemy } from './combatUtils.js';
import { injectFluidForces } from './fluidForces.js';
import { injectCrystalDisturbances } from './fluidForces.js';
import { CrystalNebula } from './crystalnebula.js';
import { DistantSuns } from './suns.js';
import { AsteroidField } from './asteroidField.js';
import { StarNestBackground } from './starNestBackground.js';
import { fireTurretShots } from './turretCombat.js';
import { updateFighterWeaponFire } from './fighterCombat.js';
import { updatePlayerFiring, updateGuidedMissileControl } from './weaponFiring.js';
import {
  type OverlayCache,
  createOverlayCache,
  buildingEffectRange,
  drawGhostSpectator,
  drawLossOverlay,
  drawCommandModeOverlay,
  drawBuildingHoverHitpoints,
  drawGlowLayer,
  drawScreenOverlays,
} from './gameOverlays.js';
import {
  type CommandModeState,
  createCommandModeState,
  updateCommandMode,
  updateNumberGroupHotkeys,
  updatePlayerFighterOrderTargets,
} from './commandMode.js';

type GamePhase = 'menu' | 'playing' | 'paused';

const PLAYER_FIRE_COOLDOWN = WEAPON_STATS.fire.fireRate * DT;
const MAX_FIXED_UPDATES_PER_FRAME = 5;

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
  private rankedVsAIResultRecorded = false;

  private phase: GamePhase = 'menu';
  private lastTimestamp: number = 0;
  private accumulator: number = 0;
  private running: boolean = false;
  private debugOverlay = false;
  private lastFrameMs = 0;
  private lastFixedUpdateMs = 0;
  private lastRenderMs = 0;
  private waypointMarkers = new Map<ShipCommandGroup, WaypointMarker>();
  private commandModeState: CommandModeState = createCommandModeState();
  /**
   * Accumulates total dt between fighter exhaust emissions.
   * Fighter exhaust is rate-limited (not every tick) to reduce particle count at scale.
   */
  private fighterExhaustAccum: number = 0;
  private activeGuidedMissile: GuidedMissile | null = null;
  private spaceFluid: SpaceFluid;
  private glowLayer: GlowLayer;
  private crystalNebula: CrystalNebula;
  private distantSuns: DistantSuns;
  private asteroidField: AsteroidField;
  private starNest: StarNestBackground;
  private visualQuality: VisualQuality = DEFAULT_VISUAL_QUALITY;
  private visualPreset: VisualQualityPreset = VISUAL_QUALITY_PRESETS[DEFAULT_VISUAL_QUALITY];
  private overlayCache: OverlayCache = createOverlayCache();
  /** Counts down after the player takes damage; drives the red-edge damage flash. */
  private damageFlashTimer: number = 0;
  /** Player health at the end of the last fixed tick (used to detect damage events). */
  private playerPrevHealth: number = -1;
  /** Accumulated game time used for territory pulse animations. */
  private territoryPulseTime: number = 0;
  /** Cached deep-space background gradient (rebuilt on resize). */
  private bgGradient: CanvasGradient | null = null;
  private bgGradientW = 0;
  private bgGradientH = 0;

  /** Respawn timer: counts down after the player ship dies. */
  private playerRespawnTimer: number = 0;
  /** True once the death has been registered so we don't re-trigger. */
  private playerDeathHandled: boolean = false;
  private playerLoss: boolean = false;
  private ghostSpectatorPos: Vec2 | null = null;
  private ghostSpectatorVel: Vec2 = new Vec2(0, 0);
  /** Delay (seconds) before the player ship respawns. */
  private static readonly RESPAWN_DELAY = 3;
  private aiRespawnTimer: number = 0;
  private aiDeathHandled: boolean = false;
  private static readonly AI_RESPAWN_DELAY = 8;
  /** Interval (seconds) between fighter exhaust particle emissions (~30 Hz). */
  private static readonly FIGHTER_EXHAUST_EMIT_INTERVAL = 1 / 30;

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
    this.crystalNebula = new CrystalNebula();
    this.distantSuns = new DistantSuns();
    // Asteroid sprites are generated here (once). Placement is seeded and deterministic.
    this.asteroidField = new AsteroidField();
    this.starNest = new StarNestBackground();
    this.spaceFluid.resize(window.innerWidth, window.innerHeight);
    this.applyVisualQuality(loadVisualQuality());

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
    this.crystalNebula.resize(window.innerWidth, window.innerHeight);
    this.starNest.resize(window.innerWidth, window.innerHeight);
    // Invalidate overlay gradient cache so drawScreenOverlays rebuilds it at the new size.
    this.overlayCache = createOverlayCache();
  }

  private applyVisualQuality(quality: VisualQuality): void {
    this.visualQuality = quality;
    this.visualPreset = VISUAL_QUALITY_PRESETS[quality];
    this.spaceFluid.setLowGraphicsMode(this.visualPreset.fluidLowGraphics);
    this.glowLayer.configure(this.visualPreset.glowEnabled, this.visualPreset.glowScale);
    this.crystalNebula.configure(this.visualPreset);
    this.distantSuns.configure(this.visualPreset);
    this.asteroidField.configure(this.visualPreset);
    this.starNest.configure(this.visualPreset);
    this.state?.ringEffects.setMaxLive(quality === 'low' ? 32 : quality === 'medium' ? 64 : 96);
    this.state?.particles.setParticleScale(this.visualPreset.particleScale);
    this.starfield.setShootingStarsEnabled(this.visualPreset.shootingStarsEnabled);
    this.mainMenu.visualQuality = quality;
    saveVisualQuality(quality);
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
    let fixedUpdates = 0;
    const fixedStart = performance.now();
    while (this.accumulator >= DT && fixedUpdates < MAX_FIXED_UPDATES_PER_FRAME) {
      this.fixedUpdate();
      Input.update();
      this.accumulator -= DT;
      fixedUpdates++;
    }
    this.lastFixedUpdateMs = performance.now() - fixedStart;
    if (fixedUpdates === MAX_FIXED_UPDATES_PER_FRAME && this.accumulator >= DT) {
      this.accumulator = 0;
    }

    const renderStart = performance.now();
    this.render();
    this.lastRenderMs = performance.now() - renderStart;

    // Update adaptive performance budget with raw frame timings
    renderBudget.update(this.lastFrameMs, this.lastFixedUpdateMs, this.lastRenderMs);
    // Wire adaptive scale into particle system
    this.state.particles.setAdaptiveScale(renderBudget.renderLoadScale);

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
    if (this.mainMenu.visualQuality !== this.visualQuality) {
      this.applyVisualQuality(this.mainMenu.visualQuality);
    }
    this.handleMenuAction(action);
  }

  private updatePaused(): void {
    const action = this.mainMenu.update(DT, this.screenW, this.screenH);
    if (this.mainMenu.visualQuality !== this.visualQuality) {
      this.applyVisualQuality(this.mainMenu.visualQuality);
    }
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

    const commandMode = Input.isDown('c');
    if (commandMode) {
      updateCommandMode({
        camera: this.camera,
        state: this.state,
        hud: this.hud,
        waypointMarkers: this.waypointMarkers,
        localTeam: this.localPlayerTeam(),
      }, this.commandModeState);
    } else {
      this.commandModeState.dragStart = null;
      this.commandModeState.dragCurrent = null;
      // Action menu is processed FIRST so it can consume arrow keys before the
      // player ship's handleInput sees them.
      const menuResult = this.actionMenu.update(this.state, this.camera);
      this.handleActionResult(menuResult);
    }

    // Update aim point from current mouse position so the ship's mouse-aim
    // logic in handleInput sees a fresh target this tick.
    if (this.state.player.alive) {
      const aimWorld = this.camera.screenToWorld(Input.mousePos);
      this.state.player.setAimPoint(aimWorld);
    }

    if (!commandMode) {
      updateNumberGroupHotkeys(
        {
          camera: this.camera,
          state: this.state,
          hud: this.hud,
          waypointMarkers: this.waypointMarkers,
          localTeam: this.localPlayerTeam(),
        },
        this.commandModeState,
        (group, order) => this.issueShipOrder(group, order),
      );
    }
    updatePlayerFighterOrderTargets(this.state);

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
    while (this.state.completedResearchNotifications.length > 0) {
      const item = this.state.completedResearchNotifications.shift()!;
      this.hud.showMessage(`Research complete: ${researchDisplayName(item)}`, Colors.researchlab_detail, 4);
    }

    // Emit build-completion particle effect for any building that just finished
    // constructing this tick.  The flag is set by Building.update() and cleared
    // here so the burst fires exactly once.
    for (const b of this.state.buildings) {
      if (b.completionEffectPending) {
        b.completionEffectPending = false;
        this.state.particles.emitBuildEffect(b.position);
      }
    }

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
    this.updateGhostSpectator(DT);

    // Advance starfield animations (twinkling, shooting stars)
    this.starfield.update(DT);
    // Advance distant-suns glint timers.
    this.distantSuns.update(DT);

    // Camera follows the living ship, or the ghost spectator while dead.
    this.camera.update(this.ghostSpectatorPos ?? this.state.player.position, DT);

    // Drain accumulated shake requests from the game state and apply to camera
    // if the current quality preset has camera shake enabled.
    if (this.state.pendingShakeMagnitude > 0) {
      if (this.visualPreset.cameraShakeEnabled) {
        this.camera.addShake(this.state.pendingShakeMagnitude);
      }
      this.state.pendingShakeMagnitude = 0;
    }

    // Drain explosion events into the crystal nebula (quality-gated).
    if (this.state.pendingCrystalExplosions.length > 0) {
      for (const exp of this.state.pendingCrystalExplosions) {
        this.crystalNebula.addExplosion(exp.x, exp.y, 1.0, exp.radius);
      }
      this.state.pendingCrystalExplosions.length = 0;
    }

    // Emit exhaust particles when the player is thrusting (any WASD key).
    // Most particles stay tied to the physical rear engine, while a smaller
    // plume preserves feedback for the active WASD thrust direction.
    if (this.state.player.alive && this.state.player.isThrusting && !this.actionMenu.open) {
      const td = this.state.player.thrustDir;
      const thrustAngle = Math.atan2(td.y, td.x);
      const isBoosting = this.state.player.isBoosting;
      // emitExhaust already emits 3 particles when isBoosting — no extra loop needed.
      const speed = Math.hypot(this.state.player.velocity.x, this.state.player.velocity.y);
      const maxSpeed = this.state.player.maxSpeed * (isBoosting ? 1.8 : 1);
      const speedFraction = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
      this.state.particles.emitExhaust(
        this.state.player.position,
        thrustAngle,
        Team.Player,
        { speedFraction, varyLightness: true, isBoosting, facingAngle: this.state.player.angle },
      );
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

    // Rate-limited fighter exhaust — emit for on-screen fighters only, at ~30 Hz
    // instead of 60 Hz to halve particle emission when many fighters are active.
    // Off-screen fighters skip emission entirely.
    this.fighterExhaustAccum += DT;
    const exhaustInterval = Game.FIGHTER_EXHAUST_EMIT_INTERVAL;
    if (this.fighterExhaustAccum >= exhaustInterval) {
      this.fighterExhaustAccum -= exhaustInterval;
      for (const f of this.state.fighters) {
        if (!f.alive || f.docked) continue;
        // Skip off-screen fighters entirely
        if (!this.camera.isOnScreen(f.position, 120)) continue;
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
    const weaponCtx = { state: this.state, camera: this.camera, hud: this.hud, spaceFluid: this.spaceFluid, actionMenu: this.actionMenu };
    this.activeGuidedMissile = updateGuidedMissileControl(weaponCtx, this.activeGuidedMissile);
    this.activeGuidedMissile = updatePlayerFiring(weaponCtx, this.activeGuidedMissile);

    // Player ship fighter spawning from shipyards
    this.updatePlayerShipyards();
    updateFighterWeaponFire(this.state, this.spaceFluid);
    if (this.state.gameMode !== 'practice' && this.state.gameMode !== 'vs_ai') {
      fireTurretShots(this.state, this.localPlayerTeam());
    }

    // Inject fluid forces from all active entities.
    this.spaceFluid.setView(this.camera.position.x, this.camera.position.y, this.camera.zoom);
    injectFluidForces(this.state, this.spaceFluid);
    // Inject crystal-nebula disturbances and advance physics.
    injectCrystalDisturbances(this.state, this.crystalNebula);
    this.crystalNebula.update(DT);

    // HUD
    this.hud.update(DT);

    // Mode-specific logic
    if (this.state.gameMode === 'practice' || this.state.gameMode === 'vs_ai') {
      this.practiceMode.update(this.state, this.hud, DT);
      this.recordRankedVsAIResultIfNeeded();
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
    this.updateAIShipRespawn(DT);
    if (this.vsAIDirector) {
      this.vsAIDirector.update(this.state, DT);
      // Drain rival AI chat and forward to HUD.
      for (const msg of this.vsAIDirector.drainChats()) {
        this.hud.showAIChat('RIVAL', msg, Colors.alert1);
      }
    }
  }

  private recordRankedVsAIResultIfNeeded(): void {
    if (this.state.gameMode !== 'vs_ai' || this.rankedVsAIResultRecorded) return;
    const cfg = this.mainMenu.vsAIConfig;
    if (!cfg.ranked || !this.practiceMode.gameOver) return;
    this.rankedVsAIResultRecorded = true;
    if (!this.practiceMode.victory) return;

    const score = Math.max(0, Math.min(3000, Math.round(cfg.aiRank)));
    let previous = 0;
    try {
      previous = Number.parseInt(window.localStorage?.getItem(VSAI_RANKED_SCORE_KEY) ?? '0', 10) || 0;
      if (score > previous) window.localStorage?.setItem(VSAI_RANKED_SCORE_KEY, `${score}`);
    } catch {
      previous = 0;
    }
    if (score > previous) {
      this.hud.showMessage(`New ranked high score: ${score}`, Colors.alert2, 8);
    }
  }

  /**
   * Detect player death, show a respawn countdown, then revive the ship near
   * the command post. Deducts resources proportional to how many buildings
   * and research items the player has (the more powerful your base, the more
   * it costs to die) — clamped to zero so you can never go negative.
   */
  private updatePlayerRespawn(): void {
    if (!this.localTeamHasRespawnCommandPost()) {
      this.playerLoss = true;
    }

    if (this.state.player.alive) {
      // Reset tracking whenever the player is alive.
      this.playerDeathHandled = false;
      this.playerRespawnTimer = 0;
      this.ghostSpectatorPos = null;
      this.ghostSpectatorVel = new Vec2(0, 0);
      return;
    }

    if (!this.ghostSpectatorPos) {
      this.ghostSpectatorPos = this.state.player.position.clone();
      this.ghostSpectatorVel = new Vec2(0, 0);
    }

    const respawnCp = this.findRespawnCommandPost();
    if (!respawnCp) {
      if (!this.playerLoss) {
        this.hud.showMessage('Loss. No Command Post remains.', Colors.alert1, 10);
      }
      this.playerLoss = true;
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
      const spawnPos = new Vec2(respawnCp.position.x, respawnCp.position.y - 60);

      this.state.player.revive(spawnPos);
      this.playerLoss = false;
      this.ghostSpectatorPos = null;
      this.ghostSpectatorVel = new Vec2(0, 0);
      this.hud.showMessage('Respawned!', Colors.friendly_status, 2);
    }
  }

  private updateAIShipRespawn(dt: number): void {
    if (this.state.gameMode !== 'vs_ai' || !this.state.aiPlayerShip) return;
    const ship = this.state.aiPlayerShip;
    if (!(ship instanceof AIShip)) return;
    if (ship.alive) {
      this.aiDeathHandled = false;
      this.aiRespawnTimer = 0;
      return;
    }

    const enemyCp = this.state.getEnemyCommandPost();
    if (!enemyCp) return;

    if (!this.aiDeathHandled) {
      this.aiDeathHandled = true;
      this.aiRespawnTimer = Game.AI_RESPAWN_DELAY;
      this.hud.showMessage(`Rival ship destroyed - respawning in ${Game.AI_RESPAWN_DELAY}s`, Colors.alert2, 3);
    }

    this.aiRespawnTimer -= dt;
    if (this.aiRespawnTimer <= 0) {
      ship.revive(new Vec2(enemyCp.position.x, enemyCp.position.y - 80));
      ship.desiredMove = new Vec2(0, 0);
      ship.desiredAim = this.state.player.position.clone();
      ship.wantsFire = false;
      this.aiDeathHandled = false;
      this.hud.showMessage('Rival ship respawned!', Colors.alert2, 2);
    }
  }

  private localPlayerTeam(): Team {
    if (this.state.gameMode === 'lan_host' ||
        this.state.gameMode === 'lan_client' ||
        this.state.gameMode === 'online_host' ||
        this.state.gameMode === 'online_client') {
      return teamForSlot(this.lanMySlot);
    }
    return Team.Player;
  }

  private localTeamHasRespawnCommandPost(): boolean {
    return this.findRespawnCommandPost() !== null;
  }

  private findRespawnCommandPost(): CommandPost | null {
    const localTeam = this.localPlayerTeam();
    const own = this.state.getCommandPostForTeam(localTeam);
    if (own) return own;

    for (const b of this.state.buildings) {
      if (!b.alive || b.type !== EntityType.CommandPost || !(b instanceof CommandPost)) continue;
      if (!isPlayableTeam(b.team)) continue;
      if (!isHostile(localTeam, b.team)) return b;
    }
    return null;
  }

  private updateGhostSpectator(dt: number): void {
    if (this.state.player.alive || !this.ghostSpectatorPos) return;

    let dx = 0;
    let dy = 0;
    if (Input.isDown('w')) dy -= 1;
    if (Input.isDown('s')) dy += 1;
    if (Input.isDown('a')) dx -= 1;
    if (Input.isDown('d')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      const speed = Input.isDown('Shift') ? 1200 : 720;
      this.ghostSpectatorVel = this.ghostSpectatorVel.add(new Vec2((dx / len) * speed * dt, (dy / len) * speed * dt));
    }
    this.ghostSpectatorVel = this.ghostSpectatorVel.scale(1 / (1 + 5 * dt));
    this.ghostSpectatorPos = this.ghostSpectatorPos.add(this.ghostSpectatorVel.scale(dt));
    this.ghostSpectatorPos.x = Math.max(0, Math.min(WORLD_WIDTH, this.ghostSpectatorPos.x));
    this.ghostSpectatorPos.y = Math.max(0, Math.min(WORLD_HEIGHT, this.ghostSpectatorPos.y));
  }

  private countShipResearchUpgrades(): number {
    let count = 0;
    for (const key of this.state.researchedItems) {
      if (key === 'shipHull' || key === 'shipBattery' || key === 'shipEngine' || key === 'shipShield') count++;
    }
    return count;
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
        } else if (!b.holdDocked) {
          fighter.order = 'waypoint';
          fighter.targetPos = b.position.clone();
          fighter.launch();
          b.dockedShips = Math.max(0, b.dockedShips - 1);
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
      case 'cancelResearch':
        this.cancelQueuedResearch(result.queueIndex);
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

    const costKey = item as keyof typeof RESEARCH_COST;
    const timeKey = item as keyof typeof RESEARCH_TIME;
    const cost = RESEARCH_COST[costKey];
    const time = RESEARCH_TIME[timeKey];

    if (cost === undefined || time === undefined) return;
    if (!(ACTIVE_RESEARCH_ITEMS as readonly string[]).includes(item)) return;
    if (this.state.researchedItems.has(item) || this.state.researchProgress.item === item || this.state.researchQueue.includes(item)) {
      this.hud.showMessage(`${researchDisplayName(item)} is already queued or complete`, Colors.alert2, 3);
      return;
    }

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
    if (this.state.researchProgress.item) {
      this.state.researchQueue.push(item);
      this.hud.showMessage(`Queued research: ${researchDisplayName(item)}`, Colors.researchlab_detail, 3);
      return;
    }
    this.state.researchProgress = {
      item,
      progress: 0,
      timeNeeded: time / TICK_RATE,
    };
    this.hud.showMessage(`Researching: ${researchDisplayName(item)}`, Colors.researchlab_detail, 3);
  }

  private cancelQueuedResearch(queueIndex: number): void {
    const [item] = this.state.researchQueue.splice(queueIndex, 1);
    if (!item) return;
    const cost = RESEARCH_COST[item as keyof typeof RESEARCH_COST];
    if (cost !== undefined) {
      if (isSynonymousFaction(this.state.factionByTeam, Team.Player)) {
        this.state.synonymous.spawnAtBase(Team.Player, cost, this.state.gameTime);
      } else {
        this.state.resources += cost;
      }
    }
    this.hud.showMessage(`Canceled research: ${researchDisplayName(item)}`, Colors.alert2, 3);
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

  private startGame(mode: 'tutorial' | 'practice' | 'vs_ai'): void {
    // Create fresh state
    const playerStart = new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);
    this.state = new GameState(playerStart);
    this.state.gameMode = mode;
    this.applyVisualQuality(this.visualQuality);
    // Reset any director from a previous match.
    this.vsAIDirector = null;
    this.rankedVsAIResultRecorded = false;

    // Reset respawn tracking.
    this.playerDeathHandled = false;
    this.playerRespawnTimer = 0;
    this.playerLoss = false;
    this.ghostSpectatorPos = null;
    this.ghostSpectatorVel = new Vec2(0, 0);
    this.aiRespawnTimer = 0;
    this.aiDeathHandled = false;
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
    this.commandModeState.selectedFighters.clear();
    this.commandModeState.selectedTurrets.clear();
    this.commandModeState.dragStart = null;
    this.commandModeState.dragCurrent = null;
    this.commandModeState.lastGroupTap = null;

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
    const rawCpPos = new Vec2(playerStart.x, playerStart.y + 80);
    const cpCell = worldToCell(rawCpPos);
    const cpPos = footprintCenter(cpCell.cx, cpCell.cy, 6);
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
      if (vcfg.ranked) {
        vcfg.difficulty = rankedDifficultyName(vcfg.aiRank);
        vcfg.aiApm = -1;
        vcfg.startingResources = 300;
        vcfg.mapSize = 'medium';
        vcfg.startingDistance = 3000;
        vcfg.fogOfWar = true;
        vcfg.cheatFullMapKnowledge = false;
        vcfg.cheat125xResources = false;
      }
      const pcfg = cloneDefaultPracticeConfig();
      pcfg.difficulty = vcfg.difficulty;
      pcfg.enemyIncomeMul = vcfg.cheat125xResources ? 1.25 : 1.0;
      pcfg.fogOfWar = vcfg.fogOfWar;
      pcfg.mapSize = vcfg.mapSize;
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
        (vcfg.ranked ? `Ranked Vs. AI started - rank ${vcfg.aiRank}` : `Vs. AI started - ${vcfg.difficulty}`) +
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
    this.playerLoss = false;
    this.ghostSpectatorPos = null;
    this.ghostSpectatorVel = new Vec2(0, 0);
    this.aiRespawnTimer = 0;
    this.aiDeathHandled = false;
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
    const rawCpPos = new Vec2(playerStart.x, playerStart.y + 80);
    const cpCell = worldToCell(rawCpPos);
    const cpPos = footprintCenter(cpCell.cx, cpCell.cy, 6);
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
    this.playerLoss = false;
    this.ghostSpectatorPos = null;
    this.ghostSpectatorVel = new Vec2(0, 0);
    this.aiRespawnTimer = 0;
    this.aiDeathHandled = false;
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
      findClosestEnemy(this.state, ship.position, ship.team, 520),
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

    // Clear with solid very-dark-blue, then overlay a cinematic blue→purple gradient
    // so the space background has subtle depth without washing out gameplay objects.
    ctx.fillStyle = colorToCSS(Colors.friendly_background);
    ctx.fillRect(0, 0, w, h);

    // Rebuild the background gradient when the canvas size changes.
    if (this.bgGradient === null || this.bgGradientW !== w || this.bgGradientH !== h) {
      this.bgGradientW = w;
      this.bgGradientH = h;
      const grad = ctx.createRadialGradient(w * 0.35, h * 0.25, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.72);
      grad.addColorStop(0.00, 'rgba(4, 10, 28, 0)');     // transparent centre — shows base fill
      grad.addColorStop(0.35, 'rgba(6, 4, 22, 0.38)');   // deep indigo tint
      grad.addColorStop(0.68, 'rgba(14, 4, 32, 0.52)');  // dark violet
      grad.addColorStop(1.00, 'rgba(8, 2, 18, 0.62)');   // near-black purple periphery
      this.bgGradient = grad;
    }
    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, w, h);

    // Star Nest volumetric background — rendered to an offscreen WebGL canvas
    // and composited here, before all other scene layers.
    this.starNest.update(this.lastFrameMs / 1000, this.camera);
    this.starNest.drawTo(ctx, w, h);

    if (this.phase === 'menu') {
      this.mainMenu.draw(ctx, w, h);
      return;
    }

    this.glowLayer.begin();

    // Draw game world
    // Layer 1: distant suns / solar glow (deepest parallax background)
    this.distantSuns.draw(ctx, this.camera, w, h);
    this.nebula.draw(ctx, this.camera, w, h);
    this.starfield.draw(ctx, this.camera, w, h);
    // Layer 2: asteroid field (disabled via asteroidFieldLayers:0; kept for code stability)
    this.asteroidField.draw(ctx, this.camera, w, h);
    // Crystal nebula clouds — behind gameplay entities, in front of starfield.
    this.crystalNebula.draw(ctx, this.camera, this.glowLayer, this.visualPreset);
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
    if (this.visualPreset.conduitPulseEnabled) {
      this.state.grid.drawConduitPulses(
        ctx,
        this.camera,
        w,
        h,
        this.state.gameTime,
        (cx, cy, team) => this.state.power.isCellEnergized(team, cx, cy),
        (cx, cy, team) => this.state.power.getFlowDir(team, cx, cy),
      );
    }
    this.state.drawEntities(ctx, this.camera);
    drawGhostSpectator(ctx, this.camera, this.state, this.ghostSpectatorPos);
    drawWaypointMarkers(ctx, this.camera, this.state, this.waypointMarkers);
    drawCommandModeOverlay(
      ctx,
      w,
      this.camera,
      this.state,
      this.commandModeState.selectedFighters,
      this.commandModeState.selectedTurrets,
      this.commandModeState.dragStart,
      this.commandModeState.dragCurrent,
    );
    drawGlowLayer(this.glowLayer, this.camera, this.state, this.visualPreset, renderBudget.renderLoadScale);
    this.glowLayer.compositeTo(ctx);

    // Edge indicators (always)
    drawEdgeIndicators(ctx, this.camera, this.state, w, h);

    // Full radar overlay (hold Tab)
    if (Input.isDown('Tab')) {
      drawRadarOverlay(ctx, this.state, w, h);
    }

    drawScreenOverlays(ctx, w, h, this.camera, this.visualPreset, this.damageFlashTimer, this.overlayCache);
    drawLossOverlay(ctx, w, this.playerLoss);

    // Action menu
    this.actionMenu.draw(ctx, this.state, this.camera, w, h);

    // HUD
    this.hud.draw(ctx, w, h);
    Input.drawTouchJoysticks(ctx);
    this.hud.drawAIChat(ctx, w, h);
    drawBuildingHoverHitpoints(ctx, this.camera, this.state);
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
        this.state.player.shield,
        this.state.player.maxShield,
        this.state.player.passiveHealthRegenActive,
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
            b.type === EntityType.PowerGenerator ||
            b.type === EntityType.Wall
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
      drawCombatTargetingDebug(ctx, this.camera, this.state);
      drawDebugOverlay(ctx, {
        screenW: w,
        state: this.state,
        lastFrameMs: this.lastFrameMs,
        fixedUpdateMs: this.lastFixedUpdateMs,
        renderMs: this.lastRenderMs,
        lanClient: this.lanClient,
        lanMySlot: this.lanMySlot,
        lanLastSnapshotSeq: this.lanLastSnapshotSeq,
        lanSnapshotSeq: this.lanSnapshotSeq,
        lanAiDirectorCount: this.lanAiDirectors.length,
        lanPredictionError: this.lanPredictionOffsetAlpha > 0
          ? Math.hypot(this.lanPredictionOffset.x, this.lanPredictionOffset.y)
          : 0,
        crystalMoteCount: this.crystalNebula.visibleMoteCount,
        visualQuality: this.visualQuality,
      });
    }

    // Pause overlay
    if (this.phase === 'paused') {
      this.mainMenu.draw(ctx, w, h);
    }
  }

  private drawPracticeHUD(ctx: CanvasRenderingContext2D, _w: number, h: number): void {
    ctx.font = '12px "Poiret One", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.7);
    ctx.fillText(
      `Bases destroyed: ${this.practiceMode.score.basesDestroyed} | Time: ${Math.floor(this.practiceMode.score.timeSurvived)}s`,
      10, 10,
    );

    // AI strategy debug info — shown when debug overlay is active.
    if (this.debugOverlay) {
      const info = this.practiceMode.getStrategyDebugInfo(this.state);
      if (info) {
        const lines = [
          `AI Strategy Debug:`,
          `  Urgency: ${info.urgency}  Player: ${info.playerStrategy}`,
          `  Shipyards: ${info.currentShipyards} / ${info.targetShipyards} (target)`,
          `  Staged: ${info.stagedCount} / ${info.waveLaunchThreshold} (wave threshold)`,
          `  Last wave: ${Math.floor(info.secsSinceLastWave)}s ago`,
          `  Failed waves: ${info.consecutiveFailedWaves}`,
        ];
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = colorToCSS(Colors.alert2, 0.85);
        let y = h - 10;
        for (let i = lines.length - 1; i >= 0; i--) {
          ctx.fillText(lines[i], 10, y);
          y -= 15;
        }
      }
    }
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

}
