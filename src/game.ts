/** Main game coordinator for Gate88 */

import { Vec2 } from './math.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Camera } from './camera.js';
import { GameState } from './gamestate.js';
import { Starfield } from './starfield.js';
import { drawEdgeIndicators, drawRadarOverlay } from './radar.js';
import { ActionMenu, MenuResult } from './actionmenu.js';
import { HUD } from './hud.js';
import { MainMenu, MenuAction } from './menu.js';
import { Colors, colorToCSS } from './colors.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import { DT, WORLD_WIDTH, WORLD_HEIGHT, RESEARCH_COST, RESEARCH_TIME, TICK_RATE, WEAPON_STATS, COMMANDPOST_BUILD_RADIUS } from './constants.js';
import { CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { FighterShip, BomberShip } from './fighter.js';
import { Bullet } from './projectile.js';
import { PracticeMode } from './practicemode.js';
import { TutorialMode } from './tutorial.js';
import { tryFireSpecial } from './special.js';
import { getBuildDef } from './builddefs.js';
import { worldToCell, cellCenter, GRID_CELL_SIZE } from './grid.js';

type GamePhase = 'menu' | 'playing' | 'paused';

const PLAYER_FIRE_COOLDOWN = WEAPON_STATS.fire.fireRate * DT;

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private camera: Camera;
  private state: GameState;
  private starfield: Starfield;
  private actionMenu: ActionMenu;
  private hud: HUD;
  private mainMenu: MainMenu;

  private practiceMode: PracticeMode;
  private tutorialMode: TutorialMode;

  private phase: GamePhase = 'menu';
  private lastTimestamp: number = 0;
  private accumulator: number = 0;
  private running: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    this.camera = new Camera();
    this.state = new GameState();
    this.starfield = new Starfield();
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
      case 'practice':
        this.startGame('practice');
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

    // Update core game state (entities, collision, power, resources, research, particles)
    this.state.update(DT);

    // Camera follows player
    this.camera.update(this.state.player.position, DT);

    // Emit exhaust particles when the player is thrusting (any WASD key).
    // Exhaust trails opposite the actual thrust direction, which under the new
    // mouse-aim controls is decoupled from the ship's facing.
    if (this.state.player.alive && this.state.player.isThrusting && !this.actionMenu.open) {
      const td = this.state.player.thrustDir;
      const thrustAngle = Math.atan2(td.y, td.x);
      this.state.particles.emitExhaust(
        this.state.player.position,
        thrustAngle,
        Team.Player,
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
    if (Input.wasPressed('n') || Input.wasPressed('N')) {
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
    if (this.state.gameMode === 'practice') {
      this.practiceMode.update(this.state, this.hud, DT);
    } else if (this.state.gameMode === 'tutorial') {
      this.tutorialMode.update(this.state, this.hud, DT);
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

    // Special ability: right mouse button. Routed through the SpecialAbility
    // registry so future abilities (cloak, dash, time bomb, ...) drop in
    // without further changes here.
    if (Input.mouse2Down) {
      tryFireSpecial(this.state, this.state.player, aimWorld);
    }
  }

  private updatePlayerShipyards(): void {
    for (const b of this.state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      if (!(b instanceof Shipyard)) continue;

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

    if (this.state.resources < def.cost) {
      this.hud.showMessage('Not enough resources!', Colors.alert1, 3);
      return;
    }

    // PR4: snap placement to the grid cell nearest the cursor and require
    // that cell to attach to the player's network — either it sits within
    // the command-post build radius, or on/adjacent to an existing player
    // conduit. This makes building placement *deterministic* (snapped) and
    // *connected* (attached to the network).
    const aimWorld = this.camera.screenToWorld(Input.mousePos);
    const cell = worldToCell(aimWorld);
    const worldPos = cellCenter(cell.cx, cell.cy);

    // Command post is exempt from the attachment requirement — there may not
    // be one yet to anchor the network to.
    if (type !== 'commandpost') {
      const cp = this.state.getPlayerCommandPost();
      const inCpRadius =
        cp !== null && worldPos.distanceTo(cp.position) <= COMMANDPOST_BUILD_RADIUS;
      const onConduit =
        this.state.grid.isOnOrAdjacentToConduit(cell.cx, cell.cy, Team.Player);
      if (!inCpRadius && !onConduit) {
        this.hud.showMessage(
          'Place along a conduit or near your Command Post.',
          Colors.alert1,
          3,
        );
        return;
      }
    }

    const building = def.factory(worldPos, Team.Player);
    if (def.buildTime > 0) {
      building.buildProgress = 0;
    }

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
        // Set target to nearest enemy building or enemy CP
        const enemyCP = this.state.getEnemyCommandPost();
        const target = enemyCP?.position ?? null;
        for (const f of fighters) {
          f.order = 'attack';
          f.targetPos = target?.clone() ?? null;
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
      case 'settarget': {
        // Set target to current camera center position
        const targetPos = this.camera.screenToWorld(
          new Vec2(this.screenW * 0.5, this.screenH * 0.5),
        );
        for (const f of fighters) {
          f.targetPos = targetPos.clone();
          f.order = 'attack';
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Target set`, Colors.general_building, 2);
        break;
      }
      // --- Phase-2 tactical orders (PR 6 will expand these with full AI) ---
      case 'defend': {
        // Placeholder: defend by attacking the enemy command post.
        const enemyCP = this.state.getEnemyCommandPost();
        for (const f of fighters) {
          f.order = 'attack';
          f.targetPos = enemyCP?.position.clone() ?? null;
          if (f.docked) f.launch();
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Defend Area`, Colors.general_building, 2);
        break;
      }
      case 'escort': {
        // Placeholder: escort by docking (stays near the shipyard / player area).
        for (const f of fighters) {
          f.order = 'dock';
        }
        this.hud.showMessage(`${ShipGroup[group]} group: Escort Player`, Colors.general_building, 2);
        break;
      }
      case 'harass': {
        // Placeholder: harass enemy power by targeting the nearest enemy generator,
        // falling back to the enemy CP if no generator exists.
        const enemyGen = this.state.buildings.find(
          (b) => b.alive && b.type === EntityType.PowerGenerator && b.team === Team.Enemy,
        );
        const harassTarget = (enemyGen ?? this.state.getEnemyCommandPost())?.position ?? null;
        for (const f of fighters) {
          f.order = 'attack';
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

  private startGame(mode: 'tutorial' | 'practice'): void {
    // Create fresh state
    const playerStart = new Vec2(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5);
    this.state = new GameState(playerStart);
    this.state.gameMode = mode;

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

    // Set initial resources
    if (mode === 'tutorial') {
      this.state.resources = 50000;
      this.tutorialMode = new TutorialMode();
      this.tutorialMode.init(this.state, this.hud);
    } else {
      this.state.resources = 500;
      this.practiceMode = new PracticeMode();
      this.practiceMode.init(this.state, this.hud);
    }

    // Start game
    this.phase = 'playing';
    this.mainMenu.close();
    Audio.stopDriveLoop();
    Audio.stopMusic();
    Audio.startPlaylist();
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
    this.starfield.draw(ctx, this.camera, w, h);
    this.state.grid.draw(ctx, this.camera, w, h);
    this.state.drawEntities(ctx, this.camera);

    // Edge indicators (always)
    drawEdgeIndicators(ctx, this.camera, this.state, w, h);

    // Full radar overlay (hold Tab)
    if (Input.isDown('Tab')) {
      drawRadarOverlay(ctx, this.state, w, h);
    }

    // Action menu
    this.actionMenu.draw(ctx, this.state, this.camera, w, h);

    // HUD
    this.hud.draw(ctx, w, h);
    this.hud.drawResources(ctx, this.state.resources, w, h);
    if (this.state.player.alive) {
      this.hud.drawSelectedBuild(ctx, this.state.selectedBuildType, this.state.resources, w, h);
      this.hud.drawPlayerEnergy(ctx, this.state.player.battery, this.state.player.maxBattery, w, h);
    }

    // Practice mode score display
    if (this.state.gameMode === 'practice' && !this.practiceMode.gameOver) {
      this.drawPracticeHUD(ctx, w, h);
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
}
