/** Main game coordinator for Gate88 */

import { Vec2 } from './math.js';
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
import { Team, EntityType, ShipGroup } from './entities.js';
import { DT, WORLD_WIDTH, WORLD_HEIGHT, RESEARCH_COST, RESEARCH_TIME, TICK_RATE, WEAPON_STATS, ACTIVE_RESEARCH_ITEMS } from './constants.js';
import { BuildingBase, CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { FighterShip, BomberShip } from './fighter.js';
import { Bullet } from './projectile.js';
import { PracticeMode } from './practicemode.js';
import { cloneDefaultPracticeConfig } from './practiceconfig.js';
import { TutorialMode } from './tutorial.js';
import { AIShip, VsAIDirector } from './vsaibot.js';
import { tryFireSpecial } from './special.js';
import { createBuildingFromDef, getBuildDef } from './builddefs.js';
import { worldToCell, footprintCenter, GRID_CELL_SIZE } from './grid.js';

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

  /** Respawn timer: counts down after the player ship dies. */
  private playerRespawnTimer: number = 0;
  /** True once the death has been registered so we don't re-trigger. */
  private playerDeathHandled: boolean = false;
  /** Delay (seconds) before the player ship respawns. */
  private static readonly RESPAWN_DELAY = 3;

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

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setScreenSize(window.innerWidth, window.innerHeight);
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

    this.updatePlayerFighterOrderTargets();

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
    this.updatePlayerFiring();

    // Player ship fighter spawning from shipyards
    this.updatePlayerShipyards();

    // HUD
    this.hud.update(DT);

    // Mode-specific logic
    if (this.state.gameMode === 'practice' || this.state.gameMode === 'vs_ai') {
      this.practiceMode.update(this.state, this.hud, DT);
    } else if (this.state.gameMode === 'tutorial') {
      this.tutorialMode.update(this.state, this.hud, DT);
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
      this.state.player.consumePrimaryFire(PLAYER_FIRE_COOLDOWN);
      const proj = new Bullet(
        Team.Player,
        this.state.player.position.clone(),
        this.state.player.angle,
        this.state.player,
      );
      this.state.addEntity(proj);
      Audio.playSound('fire');
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

      if (b.shouldSpawnShip()) {
        const isBomber = b.type === EntityType.BomberYard;
        const group = ShipGroup.Red; // default to red group
        const fighter = isBomber
          ? new BomberShip(b.position.clone(), Team.Player, group, b)
          : new FighterShip(b.position.clone(), Team.Player, group, b);
        b.activeShips++;
        this.state.addEntity(fighter);
      }
    }
  }

  private handleActionResult(result: MenuResult): void {
    switch (result.action) {
      case 'build':
        this.placeBuilding(result.buildingType);
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

  private placeBuilding(type: string): void {
    const def = getBuildDef(type);
    if (!def) return;

    // Snap placement to the grid cell nearest the cursor.
    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    const cell = worldToCell(aimWorld);
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

  private issueShipOrder(group: ShipGroup, order: string): void {
    const fighters = this.state.getFightersByGroup(Team.Player, group);

    switch (order) {
      case 'attack': {
        const target = this.camera.screenToWorld(Input.mousePos);
        for (const f of fighters) {
          f.order = 'attack';
          f.targetPos = target.clone();
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Attack!`, Colors.general_building, 2);
        break;
      }
      case 'dock':
        for (const f of fighters) {
          f.order = 'dock';
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Dock`, Colors.general_building, 2);
        break;
      case 'defend': {
        const defendPos = this.camera.screenToWorld(Input.mousePos);
        for (const f of fighters) {
          f.order = 'defend';
          f.targetPos = defendPos.clone();
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Defend Area`, Colors.general_building, 2);
        break;
      }
      case 'escort': {
        for (const f of fighters) {
          f.order = 'escort';
          f.targetPos = this.state.player.position.clone();
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Escort Player`, Colors.general_building, 2);
        break;
      }
      case 'harass': {
        const enemyGen = this.findNearestEnemyBuildingOfType(EntityType.PowerGenerator);
        const harassTarget = (enemyGen ?? this.state.getEnemyCommandPost())?.position ?? null;
        for (const f of fighters) {
          f.order = 'harass';
          f.targetPos = harassTarget?.clone() ?? null;
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Harass Power`, Colors.general_building, 2);
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
    const enemyPower = this.findNearestEnemyBuildingOfType(EntityType.PowerGenerator);
    const enemyFallback = enemyPower ?? this.state.getEnemyCommandPost();
    for (const f of this.state.fighters) {
      if (!f.alive || f.team !== Team.Player || f.docked) continue;
      if (f.order === 'escort') {
        f.targetPos = this.state.player.position.clone();
      } else if (f.order === 'harass') {
        f.targetPos = enemyFallback?.position.clone() ?? f.targetPos;
      }
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

    // Reset subsystems
    this.camera = new Camera();
    this.camera.setScreenSize(this.screenW, this.screenH);
    this.camera.position = playerStart.clone();
    this.actionMenu = new ActionMenu();
    this.hud = new HUD();

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
    const fullTech = [...allTurrets, 'bomberyard', 'advancedFighters'];
    const list = level === 'basic_turrets' ? basicTurrets
      : level === 'all_turrets' ? allTurrets
      : fullTech;
    for (const item of list) this.state.researchedItems.add(item);
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const ctx = this.ctx;
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
    this.state.grid.draw(
      ctx,
      this.camera,
      w,
      h,
      this.state.gameTime,
      (cx, cy, team) => this.state.power.isCellEnergized(team, cx, cy),
    );
    this.state.drawEntities(ctx, this.camera);

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
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.7);
    ctx.fillText(
      `Bases destroyed: ${this.practiceMode.score.basesDestroyed} | Time: ${Math.floor(this.practiceMode.score.timeSurvived)}s`,
      10, 10,
    );
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
      .map((g) => `${ShipGroup[g]} ${this.state.getFighterGroupCounts(Team.Player, g).total}`)
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

    ctx.save();
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const width = 310;
    const height = lines.length * 15 + 12;
    const x = screenW - width - 10;
    const y = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.55);
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.9);
    for (let i = 0; i < lines.length; i++) {
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
