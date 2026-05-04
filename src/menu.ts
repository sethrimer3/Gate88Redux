/**
 * Main menu, pause menu, and pre-match setup screens for Gate 88.
 *
 * All menus are fully clickable: every visible menu element exposes a
 * hit rectangle, hovered items glow, clicked items pulse and play a
 * selection sound. Existing keyboard shortcuts (Up/Down/Enter/Esc) are
 * preserved so the change is purely additive.
 *
 * Menu states:
 *   title          – top-level
 *   play           - Play submenu (Vs. AI only until multiplayer is implemented)
 *   vs_ai_setup    – Vs. AI setup screen
 *   practice_setup – Practice setup screen
 *   pause          – in-game pause overlay
 *   none           – menu hidden
 *
 * The screen ↔ MenuAction mapping is the public contract with game.ts.
 */

import { Colors, TextColors, colorToCSS } from './colors.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { buildLabel } from './version.js';
import {
  PracticeConfig,
  cloneDefaultPracticeConfig,
  DIFFICULTY_NAMES,
  DifficultyName,
  ResearchUnlock,
  VictoryCondition,
  DefeatCondition,
  MapSize,
} from './practiceconfig.js';
import {
  VsAIConfig,
  cloneDefaultVsAIConfig,
} from './vsaiconfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MenuState =
  | 'title'
  | 'play'
  | 'vs_ai_setup'
  | 'practice_setup'
  | 'pause'
  | 'none';

export type MenuAction =
  | 'none'
  | 'tutorial'
  | 'start_practice'
  | 'start_vs_ai'
  | 'resume'
  | 'quit_to_menu';

interface SimpleOption {
  label: string;
  action: () => void;
  description?: string;
}

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Background animation
// ---------------------------------------------------------------------------

interface BackgroundStar {
  x: number;
  y: number;
  speed: number;
  size: number;
  brightness: number;
}

const BG_STAR_COUNT = 160;

function createBackgroundStars(screenW: number, screenH: number): BackgroundStar[] {
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < BG_STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * screenW,
      y: Math.random() * screenH,
      speed: 8 + Math.random() * 35,
      size: 0.5 + Math.random() * 1.5,
      brightness: 0.15 + Math.random() * 0.85,
    });
  }
  return stars;
}

// ---------------------------------------------------------------------------
// Hit-test helpers
// ---------------------------------------------------------------------------

function pointInRect(px: number, py: number, r: HitRect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ---------------------------------------------------------------------------
// MainMenu class
// ---------------------------------------------------------------------------

export class MainMenu {
  state: MenuState = 'title';
  /** Keyboard cursor index for Up/Down on simple list menus. */
  private selectedIndex: number = 0;
  /** Latched click pulse for visual feedback. */
  private clickPulse: { rect: HitRect; t: number } | null = null;

  private bgStars: BackgroundStar[] = [];
  private animTime: number = 0;
  private lastScreenW: number = 0;
  private lastScreenH: number = 0;

  /** Persisted practice config; the setup screen mutates this in place. */
  practiceConfig: PracticeConfig = cloneDefaultPracticeConfig();
  /** Persisted Vs. AI config. */
  vsAIConfig: VsAIConfig = cloneDefaultVsAIConfig();

  /** Hit rectangles registered during draw, consumed during update. */
  private hits: Array<{ rect: HitRect; key: string }> = [];

  /** Mouse state captured at the start of update(), used by draw()
   *  because Input.mousePressed is cleared by Input.update() before
   *  the per-frame render() call sees it. */
  private mousePressedLatched: boolean = false;
  private mouseXLatched: number = 0;
  private mouseYLatched: number = 0;

  // Output set by setup screens after the user clicks their start button.
  private pendingAction: MenuAction = 'none';

  // -------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------

  openTitle(): void {
    this.state = 'title';
    this.selectedIndex = 0;
  }

  openPause(): void {
    this.state = 'pause';
    this.selectedIndex = 0;
  }

  close(): void {
    this.state = 'none';
  }

  private setState(s: MenuState): void {
    this.state = s;
    this.selectedIndex = 0;
    this.hits = [];
    Audio.playSound('menucursor');
  }

  // -------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------

  update(dt: number, screenW: number, screenH: number): MenuAction {
    this.animTime += dt;

    // Latch the mouse state *before* Input.update() resets `mousePressed`
    // later this tick. draw() consumes this latched state.
    // Sticky-OR semantics: only set true; the latch is cleared at the
    // end of draw(). This is needed because fixedUpdate() may run more
    // than once per rendered frame.
    if (Input.mousePressed) {
      this.mousePressedLatched = true;
      this.mouseXLatched = Input.mousePos.x;
      this.mouseYLatched = Input.mousePos.y;
    } else if (!this.mousePressedLatched) {
      // Keep the latched position fresh for hover tests when no click is queued.
      this.mouseXLatched = Input.mousePos.x;
      this.mouseYLatched = Input.mousePos.y;
    }

    if (screenW !== this.lastScreenW || screenH !== this.lastScreenH) {
      this.bgStars = createBackgroundStars(screenW, screenH);
      this.lastScreenW = screenW;
      this.lastScreenH = screenH;
    }

    for (const star of this.bgStars) {
      star.x -= star.speed * dt;
      if (star.x < 0) {
        star.x = screenW;
        star.y = Math.random() * screenH;
      }
    }

    if (this.clickPulse) {
      this.clickPulse.t -= dt;
      if (this.clickPulse.t <= 0) this.clickPulse = null;
    }

    if (this.state === 'none') return 'none';

    // Resolve any pendingAction triggered last frame by setup-screen buttons.
    if (this.pendingAction !== 'none') {
      const out = this.pendingAction;
      this.pendingAction = 'none';
      return out;
    }

    return this.handleSimpleListInput();
  }

  /**
   * For simple list-style menus (title / play / pause) we
   * support Up/Down/Enter from the keyboard. Setup menus handle all
   * input internally during draw.
   */
  private handleSimpleListInput(): MenuAction {
    const opts = this.currentSimpleOptions();
    if (!opts) return 'none';

    if (Input.wasPressed('ArrowUp')) {
      this.selectedIndex = (this.selectedIndex - 1 + opts.length) % opts.length;
      Audio.playSound('menucursor');
    }
    if (Input.wasPressed('ArrowDown')) {
      this.selectedIndex = (this.selectedIndex + 1) % opts.length;
      Audio.playSound('menucursor');
    }
    if (Input.wasPressed('Enter') || Input.wasPressed(' ')) {
      Audio.playSound('menuselection');
      opts[this.selectedIndex].action();
      return this.takePending();
    }
    if (this.state === 'pause' && Input.wasPressed('Escape')) {
      Audio.playSound('menuselection');
      this.pendingAction = 'resume';
      return this.takePending();
    }
    if (
      Input.wasPressed('Escape') &&
      (this.state === 'play' ||
        this.state === 'vs_ai_setup' ||
        this.state === 'practice_setup')
    ) {
      Audio.playSound('menucursor');
      this.setState('title');
    }

    return 'none';
  }

  private takePending(): MenuAction {
    const out = this.pendingAction;
    this.pendingAction = 'none';
    return out;
  }

  /**
   * Returns the simple-list options for the current state, or null if
   * the current state is a richer setup screen handled in draw().
   */
  private currentSimpleOptions(): SimpleOption[] | null {
    switch (this.state) {
      case 'title':
        return [
          { label: 'Play',     action: () => this.setState('play'),
            description: 'Vs. AI skirmish' },
          { label: 'Practice', action: () => this.setState('practice_setup'),
            description: 'Configurable skirmish against a growing enemy base' },
          { label: 'Tutorial', action: () => { this.pendingAction = 'tutorial'; },
            description: 'Learn the game — no enemies, infinite resources' },
        ];
      case 'play':
        return [
          { label: 'Vs. AI', action: () => this.setState('vs_ai_setup'),
            description: 'Match against an AI opponent with its own main ship' },
          { label: 'Back', action: () => this.setState('title') },
        ];
      case 'pause':
        return [
          { label: 'Resume', action: () => { this.pendingAction = 'resume'; } },
          { label: 'Quit to Menu', action: () => { this.pendingAction = 'quit_to_menu'; } },
        ];
      default:
        return null;
    }
  }

  // -------------------------------------------------------------------
  // Drawing dispatch
  // -------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (this.state === 'none') {
      // Even when invisible, clear the latch so a stray click held
      // across a state change doesn't fire after the menu reappears.
      this.mousePressedLatched = false;
      return;
    }
    this.hits = [];

    switch (this.state) {
      case 'title':           this.drawTitleScreen(ctx, screenW, screenH); break;
      case 'play':            this.drawPlayMenu(ctx, screenW, screenH); break;
      case 'vs_ai_setup':     this.drawVsAISetup(ctx, screenW, screenH); break;
      case 'practice_setup':  this.drawPracticeSetup(ctx, screenW, screenH); break;
      case 'pause':           this.drawPauseMenu(ctx, screenW, screenH); break;
    }

    // Click-pulse overlay
    if (this.clickPulse && this.clickPulse.t > 0) {
      const t = this.clickPulse.t / 0.18;
      const r = this.clickPulse.rect;
      ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, t);
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }

    // Always clear the latch at the end of a draw so the same click
    // never fires twice across consecutive frames.
    this.mousePressedLatched = false;
  }

  // -------------------------------------------------------------------
  // Background
  // -------------------------------------------------------------------

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = colorToCSS(Colors.friendly_background, 1.0);
    ctx.fillRect(0, 0, w, h);
    for (const star of this.bgStars) {
      ctx.fillStyle = colorToCSS(Colors.friendly_starfield, star.brightness * 0.6);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draw the build-number badge in the top-right corner. */
  private drawBuildBadge(ctx: CanvasRenderingContext2D, w: number): void {
    const label = buildLabel();
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const padX = 14;
    const padY = 12;

    // Subtle bracket around the build number to look like a tech version label.
    const tw = ctx.measureText(label).width;
    const x = w - padX - tw;
    const y = padY;

    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.45);
    ctx.lineWidth = 1;
    const pad = 6;
    ctx.beginPath();
    ctx.moveTo(x - pad - 4, y - 3);
    ctx.lineTo(x - pad,     y - 3);
    ctx.lineTo(x - pad,     y + 14);
    ctx.lineTo(x - pad - 4, y + 14);
    ctx.moveTo(x + tw + pad + 4, y - 3);
    ctx.lineTo(x + tw + pad,     y - 3);
    ctx.lineTo(x + tw + pad,     y + 14);
    ctx.lineTo(x + tw + pad + 4, y + 14);
    ctx.stroke();

    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.7);
    ctx.fillText(label, w - padX, padY);
  }

  // -------------------------------------------------------------------
  // Title screen
  // -------------------------------------------------------------------

  private drawTitleScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.drawBackground(ctx, w, h);
    this.drawBuildBadge(ctx, w);

    const cx = w * 0.5;
    const titleY = h * 0.24;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const ruleW = 320;
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - ruleW * 0.5, titleY - 36);
    ctx.lineTo(cx + ruleW * 0.5, titleY - 36);
    ctx.stroke();

    ctx.font = 'bold 52px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.titledark);
    ctx.fillText('GATE 88', cx + 2, titleY + 2);
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('GATE 88', cx, titleY);

    ctx.beginPath();
    ctx.moveTo(cx - ruleW * 0.5, titleY + 36);
    ctx.lineTo(cx + ruleW * 0.5, titleY + 36);
    ctx.stroke();

    const subtitleAlpha = 0.35 + 0.25 * Math.sin(this.animTime * 1.8);
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.shadow, subtitleAlpha);
    ctx.fillText('A game of space strategy', cx, titleY + 56);

    const opts = this.currentSimpleOptions()!;
    this.drawClickableOptions(ctx, cx, h * 0.50, opts);

    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.35);
    ctx.fillText('Click an option, or use \u2191 \u2193 + Enter', cx, h - 18);
  }

  // -------------------------------------------------------------------
  // Play submenu
  // -------------------------------------------------------------------

  private drawPlayMenu(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.drawBackground(ctx, w, h);
    this.drawBuildBadge(ctx, w);

    const cx = w * 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('PLAY', cx, h * 0.22);

    const opts = this.currentSimpleOptions()!;
    this.drawClickableOptions(ctx, cx, h * 0.45, opts);
  }

  // -------------------------------------------------------------------
  // Pause menu
  // -------------------------------------------------------------------

  private drawPauseMenu(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const headerY = h * 0.35;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('PAUSED', cx, headerY);
    const tw = ctx.measureText('PAUSED').width;
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - tw * 0.5, headerY + 22);
    ctx.lineTo(cx + tw * 0.5, headerY + 22);
    ctx.stroke();

    const opts = this.currentSimpleOptions()!;
    this.drawClickableOptions(ctx, cx, h * 0.5, opts);
  }

  // -------------------------------------------------------------------
  // Clickable simple list
  // -------------------------------------------------------------------

  private drawClickableOptions(
    ctx: CanvasRenderingContext2D,
    cx: number,
    startY: number,
    options: SimpleOption[],
  ): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineH = 46;
    const barW = 320;
    const mx = this.mouseXLatched;
    const my = this.mouseYLatched;

    for (let i = 0; i < options.length; i++) {
      const y = startY + i * lineH;
      const rect: HitRect = {
        x: cx - barW * 0.5,
        y: y - lineH * 0.42,
        w: barW,
        h: lineH * 0.84,
      };
      const hovered = pointInRect(mx, my, rect);
      const selected = i === this.selectedIndex;
      const highlight = hovered || selected;

      // Sync keyboard cursor with hover so feedback is unified.
      if (hovered && this.selectedIndex !== i) {
        this.selectedIndex = i;
      }

      if (highlight) {
        // Hover/selected glow
        const alpha = 0.18 + (hovered ? 0.06 : 0) + 0.04 * Math.sin(this.animTime * 4);
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, alpha);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

        ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, hovered ? 0.7 : 0.4);
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.9);
        ctx.font = '18px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('>', cx - barW * 0.5 + 12, y);
        ctx.textAlign = 'right';
        ctx.fillText('<', cx + barW * 0.5 - 12, y);

        ctx.textAlign = 'center';
        ctx.font = 'bold 18px "Courier New", monospace';
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status);
        ctx.fillText(options[i].label, cx, y - 4);

        if (options[i].description) {
          ctx.font = '11px "Courier New", monospace';
          ctx.fillStyle = colorToCSS(TextColors.shadow, 0.85);
          ctx.fillText(options[i].description ?? '', cx, y + 14);
        }
      } else {
        ctx.font = '18px "Courier New", monospace';
        ctx.fillStyle = colorToCSS(TextColors.normal, 0.55);
        ctx.textAlign = 'center';
        ctx.fillText(options[i].label, cx, y);
      }

      if (hovered && this.mousePressedLatched) {
        Audio.playSound('menuselection');
        this.clickPulse = { rect, t: 0.18 };
        this.mousePressedLatched = false; // consume so only one button fires
        Input.consumeMouseButton(0);
        options[i].action();
        return;
      }
    }
  }

  // -------------------------------------------------------------------
  // Practice setup screen
  // -------------------------------------------------------------------

  private drawPracticeSetup(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.drawBackground(ctx, w, h);
    this.drawBuildBadge(ctx, w);

    const cx = w * 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('PRACTICE SETUP', cx, 70);

    const cfg = this.practiceConfig;
    const colW = 460;
    const left = cx - colW;
    const right = cx + 12;
    let y = 130;
    const rowH = 38;

    // Left column
    y = this.drawDifficultyRow(ctx, left, y, rowH, 'Enemy Difficulty',
      cfg.difficulty, (v) => cfg.difficulty = v);
    y = this.drawSliderRow(ctx, left, y, rowH, 'Player Resources',
      cfg.playerStartingResources, 0, 5000, 50,
      (v) => cfg.playerStartingResources = v, (v) => `${v}`);
    y = this.drawSliderRow(ctx, left, y, rowH, 'Enemy Resources',
      cfg.enemyStartingResources, 0, 5000, 50,
      (v) => cfg.enemyStartingResources = v, (v) => `${v}`);
    y = this.drawSliderRow(ctx, left, y, rowH, 'Player Income x',
      cfg.playerIncomeMul, 0.25, 4.0, 0.25,
      (v) => cfg.playerIncomeMul = v, (v) => v.toFixed(2));
    y = this.drawSliderRow(ctx, left, y, rowH, 'Enemy Income x',
      cfg.enemyIncomeMul, 0.25, 4.0, 0.25,
      (v) => cfg.enemyIncomeMul = v, (v) => v.toFixed(2));
    y = this.drawSliderRow(ctx, left, y, rowH, 'Enemy Build Speed x',
      cfg.enemyBuildSpeedMul, 0.25, 4.0, 0.25,
      (v) => cfg.enemyBuildSpeedMul = v, (v) => v.toFixed(2));
    y = this.drawSliderRow(ctx, left, y, rowH, 'Enemy Max Builders',
      cfg.enemyMaxBuilders, 1, 10, 1,
      (v) => cfg.enemyMaxBuilders = v, (v) => `${v}`);
    y = this.drawSliderRow(ctx, left, y, rowH, 'Builder Rebuild (s)',
      cfg.enemyBuilderRebuildSeconds, 5, 120, 5,
      (v) => cfg.enemyBuilderRebuildSeconds = v, (v) => `${v}s`);

    // Right column
    let yr = 130;
    yr = this.drawDifficultyRow(ctx, right, yr, rowH, 'Enemy Aggression',
      cfg.enemyAggression, (v) => cfg.enemyAggression = v);
    yr = this.drawDifficultyRow(ctx, right, yr, rowH, 'Expansion Speed',
      cfg.enemyExpansionSpeed, (v) => cfg.enemyExpansionSpeed = v);
    yr = this.drawCycleRow<'tiny'|'small'|'medium'>(ctx, right, yr, rowH, 'Starting Base Size',
      cfg.enemyStartingBaseSize, ['tiny','small','medium'],
      (v) => cfg.enemyStartingBaseSize = v);
    yr = this.drawCheckboxRow(ctx, right, yr, rowH, 'Fog of War',
      cfg.fogOfWar, (v) => cfg.fogOfWar = v);
    yr = this.drawCycleRow<MapSize>(ctx, right, yr, rowH, 'Map Size',
      cfg.mapSize, ['small','medium','large'], (v) => cfg.mapSize = v);
    yr = this.drawSliderRow(ctx, right, yr, rowH, 'Starting Distance',
      cfg.startingDistance, 1000, 5000, 200,
      (v) => cfg.startingDistance = v, (v) => `${v}`);
    yr = this.drawCycleRow<ResearchUnlock>(ctx, right, yr, rowH, 'Research Unlocked',
      cfg.researchUnlocked,
      ['none','basic_turrets','all_turrets','full_tech'],
      (v) => cfg.researchUnlocked = v,
      researchUnlockLabel);
    yr = this.drawCycleRow<VictoryCondition>(ctx, right, yr, rowH, 'Victory Condition',
      cfg.victoryCondition, ['destroy_cp','survive_waves','sandbox'],
      (v) => cfg.victoryCondition = v, victoryLabel);
    yr = this.drawCycleRow<DefeatCondition>(ctx, right, yr, rowH, 'Defeat Condition',
      cfg.defeatCondition, ['cp_destroyed','ship_and_no_cp','disabled'],
      (v) => cfg.defeatCondition = v, defeatLabel);

    // Buttons
    const btnY = h - 60;
    this.drawButtonRow(ctx, [
      { label: 'Reset Defaults', action: () => {
        this.practiceConfig = cloneDefaultPracticeConfig(); } },
      { label: 'Back',           action: () => this.setState('title') },
      { label: 'Start Practice', action: () => { this.pendingAction = 'start_practice'; },
        emphasis: true },
    ], cx, btnY);
  }

  // -------------------------------------------------------------------
  // Vs. AI setup screen
  // -------------------------------------------------------------------

  private drawVsAISetup(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.drawBackground(ctx, w, h);
    this.drawBuildBadge(ctx, w);

    const cx = w * 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('VS. AI SETUP', cx, 70);

    const cfg = this.vsAIConfig;
    const colW = 460;
    const left = cx - colW;
    const right = cx + 12;
    const rowH = 38;
    let y = 140;

    y = this.drawDifficultyRow(ctx, left, y, rowH, 'AI Difficulty',
      cfg.difficulty, (v) => cfg.difficulty = v);
    y = this.drawSliderRow(ctx, left, y, rowH, 'AI APM (-1 = derived)',
      cfg.aiApm, -1, 400, 5,
      (v) => cfg.aiApm = v, (v) => v < 0 ? 'auto' : `${v}`);
    y = this.drawSliderRow(ctx, left, y, rowH, 'Starting Resources',
      cfg.startingResources, 0, 5000, 50,
      (v) => cfg.startingResources = v, (v) => `${v}`);
    y = this.drawCycleRow<MapSize>(ctx, left, y, rowH, 'Map Size',
      cfg.mapSize, ['small','medium','large'], (v) => cfg.mapSize = v);

    let yr = 140;
    yr = this.drawSliderRow(ctx, right, yr, rowH, 'Starting Distance',
      cfg.startingDistance, 1000, 5000, 200,
      (v) => cfg.startingDistance = v, (v) => `${v}`);
    yr = this.drawCheckboxRow(ctx, right, yr, rowH, 'Fog of War',
      cfg.fogOfWar, (v) => cfg.fogOfWar = v);

    // Cheater section header
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.85);
    ctx.fillText('CHEATER OPTIONS', right, yr + 8);
    yr += 28;

    yr = this.drawCheckboxRow(ctx, right, yr, rowH, 'AI Full Map Knowledge',
      cfg.cheatFullMapKnowledge, (v) => cfg.cheatFullMapKnowledge = v);
    yr = this.drawCheckboxRow(ctx, right, yr, rowH, 'AI 1.25x Resources',
      cfg.cheat125xResources, (v) => cfg.cheat125xResources = v);

    const btnY = h - 60;
    this.drawButtonRow(ctx, [
      { label: 'Reset Defaults', action: () => {
        this.vsAIConfig = cloneDefaultVsAIConfig(); } },
      { label: 'Back',     action: () => this.setState('play') },
      { label: 'Start Vs. AI', action: () => { this.pendingAction = 'start_vs_ai'; },
        emphasis: true },
    ], cx, btnY);
  }

  // -------------------------------------------------------------------
  // Setup widget primitives
  // -------------------------------------------------------------------

  /** Returns y of next row. */
  private drawDifficultyRow(
    ctx: CanvasRenderingContext2D, x: number, y: number, h: number,
    label: string, value: DifficultyName,
    onChange: (v: DifficultyName) => void,
  ): number {
    const idx = DIFFICULTY_NAMES.indexOf(value);
    return this.drawCycleRow<DifficultyName>(
      ctx, x, y, h, label, value, DIFFICULTY_NAMES, onChange,
      (v) => v, // identity
      idx / Math.max(1, DIFFICULTY_NAMES.length - 1),
    );
  }

  private drawCycleRow<T>(
    ctx: CanvasRenderingContext2D, x: number, y: number, h: number,
    label: string, value: T, values: T[],
    onChange: (v: T) => void,
    fmt?: (v: T) => string,
    intensity: number = 0,
  ): number {
    this.drawRowLabel(ctx, x, y, label);

    const valX = x + 200;
    const arrowW = 20;
    const valW = 220;

    const leftRect: HitRect = { x: valX, y: y - 12, w: arrowW, h: 24 };
    const rightRect: HitRect = { x: valX + valW - arrowW, y: y - 12, w: arrowW, h: 24 };
    const bodyRect: HitRect = { x: valX + arrowW, y: y - 12, w: valW - arrowW * 2, h: 24 };

    // Optional intensity tint (used for difficulty)
    if (intensity > 0) {
      const r = Math.floor(40 + 200 * intensity);
      const g = Math.floor(180 - 140 * intensity);
      ctx.fillStyle = `rgba(${r},${g},40,${0.10 + 0.10 * intensity})`;
      ctx.fillRect(bodyRect.x, bodyRect.y, bodyRect.w, bodyRect.h);
    }

    this.drawArrow(ctx, leftRect, '<');
    this.drawArrow(ctx, rightRect, '>');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '14px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.normal, 0.95);
    const text = fmt ? fmt(value) : String(value);
    ctx.fillText(text, bodyRect.x + bodyRect.w / 2, y);

    if (this.handleClick(leftRect)) {
      const i = values.indexOf(value);
      onChange(values[(i - 1 + values.length) % values.length]);
    }
    if (this.handleClick(rightRect)) {
      const i = values.indexOf(value);
      onChange(values[(i + 1) % values.length]);
    }
    if (this.handleClick(bodyRect)) {
      const i = values.indexOf(value);
      onChange(values[(i + 1) % values.length]);
    }
    return y + h;
  }

  private drawSliderRow(
    ctx: CanvasRenderingContext2D, x: number, y: number, h: number,
    label: string, value: number, min: number, max: number, step: number,
    onChange: (v: number) => void,
    fmt: (v: number) => string,
  ): number {
    this.drawRowLabel(ctx, x, y, label);

    const sx = x + 200;
    const sw = 220;
    const trackY = y;
    const track: HitRect = { x: sx, y: trackY - 8, w: sw, h: 16 };

    const t = (value - min) / Math.max(1e-6, max - min);
    const knobX = sx + Math.max(0, Math.min(1, t)) * sw;

    // Track
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(track.x + 0.5, trackY - 0.5, track.w - 1, 1);

    // Filled portion
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.55);
    ctx.fillRect(sx, trackY - 1, knobX - sx, 2);

    // Knob
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status);
    ctx.beginPath();
    ctx.arc(knobX, trackY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Value
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorToCSS(TextColors.normal, 0.85);
    ctx.fillText(fmt(value), sx + sw + 12, y);

    if (this.handleClick(track) || (Input.mouseDown && pointInRect(Input.mousePos.x, Input.mousePos.y, track))) {
      const tt = Math.max(0, Math.min(1, (Input.mousePos.x - sx) / sw));
      let v = min + tt * (max - min);
      v = Math.round(v / step) * step;
      v = Math.max(min, Math.min(max, v));
      if (v !== value) {
        onChange(v);
        Audio.playSound('menucursor');
      }
    }

    return y + h;
  }

  private drawCheckboxRow(
    ctx: CanvasRenderingContext2D, x: number, y: number, h: number,
    label: string, value: boolean, onChange: (v: boolean) => void,
  ): number {
    this.drawRowLabel(ctx, x, y, label);

    const box: HitRect = { x: x + 200, y: y - 9, w: 18, h: 18 };
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    if (value) {
      ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.85);
      ctx.fillRect(box.x + 4, box.y + 4, box.w - 8, box.h - 8);
    }

    if (this.handleClick(box)) onChange(!value);
    return y + h;
  }

  private drawRowLabel(
    ctx: CanvasRenderingContext2D, x: number, y: number, label: string,
  ): void {
    ctx.font = '13px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorToCSS(TextColors.normal, 0.9);
    ctx.fillText(label, x, y);
  }

  private drawArrow(
    ctx: CanvasRenderingContext2D, rect: HitRect, glyph: string,
  ): void {
    const hovered = pointInRect(Input.mousePos.x, Input.mousePos.y, rect);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines,
      hovered ? 0.9 : 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    ctx.font = '14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorToCSS(
      hovered ? Colors.radar_friendly_status : TextColors.normal,
      hovered ? 1.0 : 0.85,
    );
    ctx.fillText(glyph, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  private drawButtonRow(
    ctx: CanvasRenderingContext2D,
    buttons: Array<{ label: string; action: () => void; emphasis?: boolean }>,
    cx: number, y: number,
  ): void {
    const btnW = 180;
    const gap = 24;
    const totalW = buttons.length * btnW + (buttons.length - 1) * gap;
    let bx = cx - totalW / 2;

    for (const b of buttons) {
      const rect: HitRect = { x: bx, y: y - 18, w: btnW, h: 36 };
      const hovered = pointInRect(Input.mousePos.x, Input.mousePos.y, rect);

      const fill = b.emphasis
        ? colorToCSS(Colors.radar_friendly_status, hovered ? 0.35 : 0.20)
        : colorToCSS(Colors.radar_gridlines, hovered ? 0.30 : 0.15);
      ctx.fillStyle = fill;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      ctx.strokeStyle = colorToCSS(
        b.emphasis ? Colors.radar_friendly_status : Colors.radar_gridlines,
        hovered ? 0.95 : 0.6,
      );
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colorToCSS(TextColors.normal, hovered ? 1.0 : 0.85);
      ctx.fillText(b.label, rect.x + rect.w / 2, rect.y + rect.h / 2);

      if (this.handleClick(rect)) b.action();

      bx += btnW + gap;
    }
  }

  /**
   * Returns true and consumes the click if the mouse was just pressed
   * inside `rect` this frame. Plays selection sound and starts a click
   * pulse for visual feedback.
   */
  private handleClick(rect: HitRect): boolean {
    if (!this.mousePressedLatched) return false;
    if (!pointInRect(this.mouseXLatched, this.mouseYLatched, rect)) return false;
    Audio.playSound('menuselection');
    this.clickPulse = { rect, t: 0.18 };
    this.mousePressedLatched = false;
    Input.consumeMouseButton(0);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Local label helpers
// ---------------------------------------------------------------------------

function researchUnlockLabel(v: ResearchUnlock): string {
  switch (v) {
    case 'none':          return 'None';
    case 'basic_turrets': return 'Basic Turrets';
    case 'all_turrets':   return 'All Turrets';
    case 'full_tech':     return 'Full Tech';
  }
}

function victoryLabel(v: VictoryCondition): string {
  switch (v) {
    case 'destroy_cp':     return 'Destroy Enemy CP';
    case 'survive_waves':  return 'Survive Waves';
    case 'sandbox':        return 'Sandbox';
  }
}

function defeatLabel(v: DefeatCondition): string {
  switch (v) {
    case 'cp_destroyed':   return 'CP Destroyed';
    case 'ship_and_no_cp': return 'Ship + No CP';
    case 'disabled':       return 'Disabled';
  }
}
