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
import { Colors, colorToCSS, type Color } from './colors.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import { DT, WORLD_WIDTH, WORLD_HEIGHT, RESEARCH_COST, RESEARCH_TIME, TICK_RATE, WEAPON_STATS, ACTIVE_RESEARCH_ITEMS } from './constants.js';
import { BuildingBase, CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { FighterShip, BomberShip } from './fighter.js';
import { Bullet, GatlingBullet, Laser } from './projectile.js';
import { GuidedMissile, BomberMissile } from './projectile.js';
import { PracticeMode } from './practicemode.js';
import { cloneDefaultPracticeConfig } from './practiceconfig.js';
import { TutorialMode } from './tutorial.js';
import { AIShip, VsAIDirector } from './vsaibot.js';
import { tryFireSpecial } from './special.js';
import { GATLING_BATTERY_FIRE_COST, GUIDED_MISSILE_CONTROL_BATTERY_DRAIN, GUIDED_MISSILE_INITIAL_BATTERY_COST } from './ship.js';
import { createBuildingFromDef, getBuildDef } from './builddefs.js';
import { worldToCell, footprintCenter, GRID_CELL_SIZE } from './grid.js';
import { gameFont } from './fonts.js';
import { createSpaceFluid, SpaceFluid } from './spacefluid.js';
import type { LanClient } from './lan/lanClient.js';
import type { MsgMatchStart, MsgRelayedInput, SerializedShip, SerializedBuilding, SerializedFighter, SerializedProjectile } from './lan/protocol.js';
import { PlayerShip } from './ship.js';
import { teamForSlot } from './teamutils.js';
import { cloneDefaultVsAIConfig } from './vsaiconfig.js';

type GamePhase = 'menu' | 'playing' | 'paused';
type ShipCommandGroup = ShipGroup | 'all';
type WaypointMarker = { pos: Vec2; issuedAt: number };

const PLAYER_FIRE_COOLDOWN = WEAPON_STATS.fire.fireRate * DT;
const GROUP_COLORS: Record<ShipGroup, Color> = {
  [ShipGroup.Red]: Colors.redgroup,
  [ShipGroup.Green]: Colors.greengroup,
  [ShipGroup.Blue]: Colors.bluegroup,
};

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

  /** Respawn timer: counts down after the player ship dies. */
  private playerRespawnTimer: number = 0;
  /** True once the death has been registered so we don't re-trigger. */
  private playerDeathHandled: boolean = false;
  /** Delay (seconds) before the player ship respawns. */
  private static readonly RESPAWN_DELAY = 3;

  // LAN multiplayer
  private lanClient: LanClient | null = null;
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
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
    this.spaceFluid.resize(window.innerWidth, window.innerHeight);
    this.spaceFluid.setLowGraphicsMode(false);

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

    // LAN host: apply buffered remote inputs BEFORE the simulation tick so
    // remote players' inputs are always included in the current frame.
    if (this.state.gameMode === 'lan_host') {
      this.applyRemoteLanInputs();
      // Tick all LAN AI directors (they steer their ships before state.update).
      for (const dir of this.lanAiDirectors) {
        dir.update(this.state, DT);
      }
    }

    // Update core game state (entities, collision, power, resources, research, particles)
    this.state.update(DT);

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
      for (let i = 0; i < exhaustCount; i++) {
        this.state.particles.emitExhaust(
          this.state.player.position,
          thrustAngle,
          Team.Player,
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
        );
      }
      if (this.state.player.isStrafingRight) {
        this.state.particles.emitSideExhaust(
          this.state.player.position,
          this.state.player.angle,
          1,
          Team.Player,
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
    } else if (this.state.gameMode === 'lan_host') {
      // Broadcast snapshot on interval (remote inputs were applied above).
      this.lanSnapshotTimer -= DT;
      if (this.lanSnapshotTimer <= 0) {
        this.lanSnapshotTimer = Game.SNAPSHOT_INTERVAL;
        this.broadcastLanSnapshot();
      }
    } else if (this.state.gameMode === 'lan_client') {
      // Send local input to the server every tick.
      this.sendLanInput();
    }

    // Vs. AI bot-player: tick the strategic director every frame. The
    // director itself runs cheap decisions on a difficulty-scaled
    // interval; the per-tick driveShip just steers / fires.
    if (this.vsAIDirector) {
      this.vsAIDirector.update(this.state, DT);
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

      // Resource penalty: base cost + scaling per building and research item.
      const playerBuildings = this.state.buildings.filter(
        (b) => b.alive && b.team === Team.Player,
      ).length;
      const researchItems = this.state.researchedItems.size;
      const penalty = 50 + playerBuildings * 10 + researchItems * 15;
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

  private updatePlayerFiring(): void {
    if (!this.state.player.alive) return;
    // Don't fire when action menu is open or in placement mode
    if (this.actionMenu.open || this.actionMenu.placementMode) return;

    const aimWorld = this.camera.screenToWorld(Input.mousePos);

    // Primary fire: left mouse button only.
    if (Input.mouseDown && this.state.player.canFirePrimary()) {
      this.fireSelectedPrimary(aimWorld);
    }

    // Special ability: right mouse button. The only exposed ability for now
    // is the homing missile; hidden ability ids are ignored by menus/research.
    if (Input.mouse2Down) {
      tryFireSpecial(this.state, this.state.player, aimWorld);
    }
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
        const fighter = isBomber
          ? new BomberShip(b.position.clone(), Team.Player, group, b)
          : new FighterShip(b.position.clone(), Team.Player, group, b);
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

    this.state.player.consumePrimaryFire(PLAYER_FIRE_COOLDOWN * this.state.player.fireCooldownMultiplier);
    this.state.addEntity(new Bullet(
      Team.Player,
      this.state.player.position.clone(),
      this.state.player.angle,
      this.state.player,
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

  private damageLaserLine(start: Vec2, end: Vec2, damage: number): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return;
    for (const target of this.state.allEntities()) {
      if (!target.alive || target.team !== Team.Enemy) continue;
      const tx = target.position.x - start.x;
      const ty = target.position.y - start.y;
      const t = Math.max(0, Math.min(1, (tx * dx + ty * dy) / lenSq));
      const px = start.x + dx * t;
      const py = start.y + dy * t;
      const dist = Math.hypot(target.position.x - px, target.position.y - py);
      if (dist <= target.radius + 2) {
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
    this.state.resources -= def.cost;
    this.state.addEntity(building);
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

    if (this.state.resources < cost) {
      this.hud.showMessage('Not enough resources for research!', Colors.alert1, 3);
      return;
    }

    this.state.resources -= cost;
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
      if (f instanceof BomberShip) {
        f.consumeShot(WEAPON_STATS.bigmissile.fireRate);
        this.state.addEntity(new BomberMissile(f.team, f.position.clone(), angle, f));
        Audio.playSound('missile');
      } else {
        f.consumeShot(WEAPON_STATS.fire.fireRate);
        this.state.addEntity(new Bullet(f.team, f.position.clone(), angle, f));
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
    // Reset any director from a previous match.
    this.vsAIDirector = null;

    // Reset respawn tracking.
    this.playerDeathHandled = false;
    this.playerRespawnTimer = 0;
    this.activeGuidedMissile = null;

    // Reset subsystems
    this.camera = new Camera();
    this.camera.setScreenSize(this.screenW, this.screenH);
    this.camera.position = playerStart.clone();
    this.actionMenu = new ActionMenu();
    this.hud = new HUD();
    this.waypointMarkers.clear();

    this.spaceFluid.reset();
    this.spaceFluid.resize(this.screenW, this.screenH);

    // Create player command post near player
    const cpPos = new Vec2(playerStart.x, playerStart.y + 80);
    const cp = new CommandPost(cpPos, Team.Player);
    this.state.addEntity(cp);

    // Seed a small starter conduit network around the player CP so that
    // shipyards / labs / factories placed near the CP can be powered
    // immediately. Without this, post-PR8 power rules (shipyards no
    // longer self-power) would force the player to paint conduits
    // before their first shipyard could function.
    const startCx = Math.floor(cpPos.x / GRID_CELL_SIZE);
    const startCy = Math.floor(cpPos.y / GRID_CELL_SIZE);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= 2) {
          this.state.grid.addConduit(startCx + dx, startCy + dy, Team.Player);
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

    const myTeam = teamForSlot(this.lanMySlot);
    const playerStart = new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);

    // Build fresh game state for host slot 0.
    this.state = new GameState(playerStart);
    this.state.gameMode = isHost ? 'lan_host' : 'lan_client';
    this.vsAIDirector = null;
    this.playerDeathHandled = false;
    this.playerRespawnTimer = 0;
    this.activeGuidedMissile = null;
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
        const aiStart = new Vec2(
          playerStart.x + (slot.slotIndex - 4) * 300,
          playerStart.y - 400,
        );
        const aiShip = new AIShip(aiStart, aiTeam);
        this.state.playerShips.set(slot.slotIndex, aiShip);

        const aiCfg = cloneDefaultVsAIConfig();
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
    this.state.addEntity(cp);

    const startCx = Math.floor(cpPos.x / GRID_CELL_SIZE);
    const startCy = Math.floor(cpPos.y / GRID_CELL_SIZE);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= 2) {
          this.state.grid.addConduit(startCx + dx, startCy + dy, myTeam);
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

  /**
   * Apply a relayed game snapshot to non-authoritative client state.
   * Ships: directly write position/velocity onto existing ship objects.
   * Buildings: sync health/buildProgress for known buildings (matched by id).
   * Fighters and projectiles: reconcile the local list against snapshot ids.
   */
  private applyLanSnapshot(snapshot: {
    seq: number;
    ships: SerializedShip[];
    buildings: SerializedBuilding[];
    fighters: SerializedFighter[];
    projectiles: SerializedProjectile[];
    resourcesPerSlot: number[];
  }): void {
    // --- Ships ---
    for (const sd of snapshot.ships) {
      if (sd.slotIndex === this.lanMySlot) continue; // skip local ship
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
      }
      // Note: We don't create buildings from snapshots for now; the host's
      // authoritative state will have them, but clients start from the same
      // seed layout. Full building sync (create/destroy) is a future pass.
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
  private broadcastLanSnapshot(): void {
    if (!this.lanClient?.connected) return;

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

    // --- Projectiles (only fast-moving bullets/missiles) ---
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

    // --- Resources per slot (sparse, indexed by slot) ---
    const resourcesPerSlot: number[] = new Array(8).fill(0);
    resourcesPerSlot[this.lanMySlot] = this.state.resources;

    this.lanClient.sendGameSnapshot({
      seq: this.lanSnapshotSeq++,
      gameTime: this.state.gameTime,
      ships,
      buildings,
      fighters,
      projectiles,
      resourcesPerSlot,
      hostSlot: 0,
    });
  }

  /**
   * Send this client's local input to the server (for the host to apply).
   * Called every tick for non-host LAN clients.
   */
  private sendLanInput(): void {
    if (!this.lanClient?.connected) return;
    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    this.lanClient.sendInputSnapshot({
      seq: this.lanInputSeq++,
      dx: (Input.isDown('d') ? 1 : 0) - (Input.isDown('a') ? 1 : 0),
      dy: (Input.isDown('s') ? 1 : 0) - (Input.isDown('w') ? 1 : 0),
      aimX: aimWorld.x,
      aimY: aimWorld.y,
      firePrimary: Input.mouseDown,
      fireSpecial: Input.mouse2Down,
      boost: Input.isDown('Shift'),
    });
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
    }
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const ctx = this.ctx;
    ctx.font = gameFont(12);
    const w = this.screenW;
    const h = this.screenH;

    // Clear
    ctx.fillStyle = colorToCSS(Colors.friendly_background);
    ctx.fillRect(0, 0, w, h);

    if (this.phase === 'menu') {
      this.mainMenu.draw(ctx, w, h);
      return;
    }

    // Draw game world
    this.nebula.draw(ctx, this.camera, w, h);
    this.starfield.draw(ctx, this.camera, w, h);
    // Advance the fluid simulation by the frame delta and draw it under the game world.
    this.spaceFluid.step(this.lastFrameMs);
    this.spaceFluid.render(ctx);
    this.state.grid.draw(
      ctx,
      this.camera,
      w,
      h,
      this.state.gameTime,
      (cx, cy, team) => this.state.power.isCellEnergized(team, cx, cy),
    );
    this.state.drawEntities(ctx, this.camera);
    this.drawWaypointMarkers(ctx);

    // Edge indicators (always)
    drawEdgeIndicators(ctx, this.camera, this.state, w, h);

    // Full radar overlay (hold Tab)
    if (Input.isDown('Tab')) {
      drawRadarOverlay(ctx, this.state, w, h);
    }

    // Vignette — darkens the viewport edges to create a deep-space atmosphere.
    this.drawVignette(ctx, w, h);

    // Action menu
    this.actionMenu.draw(ctx, this.state, this.camera, w, h);

    // HUD
    this.hud.draw(ctx, w, h);
    this.hud.drawResources(ctx, this.state.resources, w, h);
    if (this.state.player.alive) {
      this.hud.drawSelectedBuild(ctx, this.state.selectedBuildType, this.state.resources, w, h);
      this.hud.drawPlayerEnergy(ctx, this.state.player.battery, this.state.player.maxBattery, w, h);
      this.hud.drawResearchStatus(ctx, this.state.researchProgress, this.state.researchedItems.size, h);
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

    // Practice / Vs. AI mode HUD
    if ((this.state.gameMode === 'practice' || this.state.gameMode === 'vs_ai')
        && !this.practiceMode.gameOver) {
      this.drawPracticeHUD(ctx, w, h);
    }

    if (this.debugOverlay) {
      this.drawDebugOverlay(ctx, w);
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

  private drawWaypointMarkers(ctx: CanvasRenderingContext2D): void {
    const drawOrder: ShipCommandGroup[] = [ShipGroup.Red, ShipGroup.Green, ShipGroup.Blue, 'all'];
    for (const group of drawOrder) {
      const marker = this.waypointMarkers.get(group);
      if (!marker) continue;
      const screen = this.camera.worldToScreen(marker.pos);
      const color = group === 'all' ? Colors.mainguy : GROUP_COLORS[group];
      const label = group === 'all' ? 'ALL' : `${group + 1}`;
      const t = this.state.gameTime - marker.issuedAt;
      const phase = this.state.gameTime * 3.2 + (group === 'all' ? 1.8 : group);
      const pulse = 0.5 + 0.5 * Math.sin(phase);
      const ring = (18 + pulse * 6) * this.camera.zoom;
      const lift = Math.sin(this.state.gameTime * 1.7 + t) * 3 * this.camera.zoom;

      ctx.save();
      ctx.translate(screen.x, screen.y + lift);
      ctx.globalCompositeOperation = 'lighter';

      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, ring * 1.8);
      grad.addColorStop(0, colorToCSS(color, 0.26));
      grad.addColorStop(0.42, colorToCSS(color, 0.10));
      grad.addColorStop(1, colorToCSS(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, ring * 1.8, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate(this.state.gameTime * (0.9 + i * 0.23) + i * Math.PI * 0.66);
        ctx.strokeStyle = colorToCSS(color, 0.45 - i * 0.08);
        ctx.lineWidth = Math.max(1, 1.4 * this.camera.zoom);
        ctx.beginPath();
        ctx.ellipse(0, 0, ring * (1 + i * 0.26), ring * (0.42 + i * 0.12), 0, 0.18, Math.PI * 1.72);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = colorToCSS(color, 0.76);
      ctx.lineWidth = Math.max(1, 1.2 * this.camera.zoom);
      ctx.beginPath();
      ctx.moveTo(0, -ring * 0.9);
      ctx.lineTo(ring * 0.7, 0);
      ctx.lineTo(0, ring * 0.9);
      ctx.lineTo(-ring * 0.7, 0);
      ctx.closePath();
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `bold ${Math.max(9, 12 * this.camera.zoom)}px "Poiret One", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colorToCSS(Colors.particles_switch, 0.92);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  private drawDebugOverlay(ctx: CanvasRenderingContext2D, screenW: number): void {
    const playerBuildings = this.state.buildings.filter((b) => b.alive && b.team === Team.Player);
    const enemyBuildings = this.state.buildings.filter((b) => b.alive && b.team === Team.Enemy);
    const powered = playerBuildings.filter((b) => b.buildProgress >= 1 && b.powered).length;
    const unpowered = playerBuildings.filter((b) => b.buildProgress >= 1 && !b.powered).length;
    const research = this.state.researchProgress.item
      ? `${this.state.researchProgress.item} ${Math.floor(
          (this.state.researchProgress.progress / Math.max(1, this.state.researchProgress.timeNeeded)) * 100,
        )}%`
      : 'none';
    const groups = [ShipGroup.Red, ShipGroup.Green, ShipGroup.Blue]
      .map((g) => `${g + 1} ${this.state.getFighterGroupCounts(Team.Player, g).total}`)
      .join(' / ');

    const lines = [
      `mode ${this.state.gameMode}  frame ${this.lastFrameMs.toFixed(1)}ms`,
      `resources ${Math.floor(this.state.resources)}  build ${this.state.selectedBuildType ?? 'none'}`,
      `ship hp ${Math.ceil(this.state.player.health)}/${this.state.player.maxHealth}  battery ${Math.floor(this.state.player.battery)}/${this.state.player.maxBattery}`,
      `buildings player ${playerBuildings.length} enemy ${enemyBuildings.length}`,
      `conduits ${this.state.grid.conduitCount()} pending ${this.state.grid.pendingConduitCount()}`,
      `power player ${powered} powered / ${unpowered} unpowered`,
      `research ${research}`,
      `fighters ${groups}`,
    ];

    // LAN-specific debug lines.
    const isLan = this.state.gameMode === 'lan_host' || this.state.gameMode === 'lan_client';
    if (isLan && this.lanClient) {
      const role = this.state.gameMode === 'lan_host' ? 'host' : 'client';
      lines.push(`LAN ${role}  slot ${this.lanMySlot + 1}  ping ${this.lanClient.pingMs}ms`);
      if (this.state.gameMode === 'lan_client') {
        const age = this.lanClient.lastSnapshotAt > 0
          ? Math.round(performance.now() - this.lanClient.lastSnapshotAt)
          : -1;
        const seqStr = this.lanLastSnapshotSeq >= 0 ? `seq ${this.lanLastSnapshotSeq}` : 'no snapshot';
        lines.push(`snapshot ${seqStr}  age ${age >= 0 ? age + 'ms' : 'n/a'}`);
        if (age > 3000) lines.push('⚠ WARNING: No snapshot for >3s');
      }
      if (this.state.gameMode === 'lan_host') {
        lines.push(`snap seq ${this.lanSnapshotSeq}  AI dirs ${this.lanAiDirectors.length}`);
      }
    }

    ctx.save();
    ctx.font = '11px "Poiret One", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const width = 330;
    const height = lines.length * 15 + 12;
    const x = screenW - width - 10;
    const y = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.55);
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    for (let i = 0; i < lines.length; i++) {
      // Highlight LAN warning lines in yellow.
      const isWarning = lines[i].startsWith('⚠');
      ctx.fillStyle = isWarning
        ? colorToCSS(Colors.alert2, 0.95)
        : colorToCSS(Colors.general_building, 0.9);
      ctx.fillText(lines[i], x + 8, y + 7 + i * 15);
    }
    ctx.restore();
  }

  /**
   * Draws a soft radial vignette over the entire viewport using a
   * transparent-to-black radial gradient.  The effect deepens the sense of
   * looking out into space from inside a cockpit.
   */
  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const outerR = Math.hypot(cx, cy);
    const innerR = outerR * 0.55;

    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0.0, 'rgba(0,0,0,0)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0.55)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

