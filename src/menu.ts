/** Main menu and pause menu system for Gate88 */

import { Colors, TextColors, colorToCSS, Color } from './colors.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MenuState = 'title' | 'pause' | 'none';

export type MenuAction =
  | 'none'
  | 'tutorial'
  | 'practice'
  | 'resume'
  | 'quit_to_menu';

interface MenuOption {
  label: string;
  action: MenuAction;
  description?: string;
}

// ---------------------------------------------------------------------------
// Menu definition
// ---------------------------------------------------------------------------

const TITLE_OPTIONS: MenuOption[] = [
  { label: 'Tutorial', action: 'tutorial', description: 'Learn the game — no enemies, infinite resources' },
  { label: 'Practice', action: 'practice', description: 'Survive waves of enemy bases' },
];

const PAUSE_OPTIONS: MenuOption[] = [
  { label: 'Resume', action: 'resume' },
  { label: 'Quit to Menu', action: 'quit_to_menu' },
];

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
// MainMenu class
// ---------------------------------------------------------------------------

export class MainMenu {
  state: MenuState = 'title';
  private selectedIndex: number = 0;
  private bgStars: BackgroundStar[] = [];
  private animTime: number = 0;
  private lastScreenW: number = 0;
  private lastScreenH: number = 0;

  /** Process input and return any menu action. */
  update(dt: number, screenW: number, screenH: number): MenuAction {
    this.animTime += dt;

    // Regenerate background stars if screen size changed
    if (screenW !== this.lastScreenW || screenH !== this.lastScreenH) {
      this.bgStars = createBackgroundStars(screenW, screenH);
      this.lastScreenW = screenW;
      this.lastScreenH = screenH;
    }

    // Animate background stars
    for (const star of this.bgStars) {
      star.x -= star.speed * dt;
      if (star.x < 0) {
        star.x = screenW;
        star.y = Math.random() * screenH;
      }
    }

    if (this.state === 'none') return 'none';

    const options = this.currentOptions();

    // Up / Down navigate; Enter (or Space) confirms
    if (Input.wasPressed('ArrowUp')) {
      this.selectedIndex = (this.selectedIndex - 1 + options.length) % options.length;
      Audio.playSound('menucursor');
    }
    if (Input.wasPressed('ArrowDown')) {
      this.selectedIndex = (this.selectedIndex + 1) % options.length;
      Audio.playSound('menucursor');
    }

    if (Input.wasPressed('Enter') || Input.wasPressed(' ')) {
      const action = options[this.selectedIndex].action;
      Audio.playSound('menuselection');
      return action;
    }

    // ESC on pause menu resumes
    if (this.state === 'pause' && Input.wasPressed('Escape')) {
      Audio.playSound('menuselection');
      return 'resume';
    }

    return 'none';
  }

  private currentOptions(): MenuOption[] {
    return this.state === 'pause' ? PAUSE_OPTIONS : TITLE_OPTIONS;
  }

  /** Open the pause menu. */
  openPause(): void {
    this.state = 'pause';
    this.selectedIndex = 0;
  }

  /** Switch to title screen. */
  openTitle(): void {
    this.state = 'title';
    this.selectedIndex = 0;
  }

  /** Dismiss the menu entirely. */
  close(): void {
    this.state = 'none';
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (this.state === 'none') return;

    if (this.state === 'title') {
      this.drawTitleScreen(ctx, screenW, screenH);
    } else {
      this.drawPauseMenu(ctx, screenW, screenH);
    }
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
  ): void {
    // Very dark background
    ctx.fillStyle = colorToCSS(Colors.friendly_background, 1.0);
    ctx.fillRect(0, 0, screenW, screenH);

    // Animated scrolling stars
    for (const star of this.bgStars) {
      ctx.fillStyle = colorToCSS(Colors.friendly_starfield, star.brightness * 0.6);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTitleScreen(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
  ): void {
    this.drawBackground(ctx, screenW, screenH);

    const cx = screenW * 0.5;
    const titleY = screenH * 0.28;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Decorative horizontal rule above title
    const ruleW = 320;
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - ruleW * 0.5, titleY - 36);
    ctx.lineTo(cx + ruleW * 0.5, titleY - 36);
    ctx.stroke();

    // Shadow
    ctx.font = 'bold 52px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.titledark);
    ctx.fillText('GATE 88', cx + 2, titleY + 2);

    // Main title
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('GATE 88', cx, titleY);

    // Decorative horizontal rule below title
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - ruleW * 0.5, titleY + 36);
    ctx.lineTo(cx + ruleW * 0.5, titleY + 36);
    ctx.stroke();

    // Pulsing tagline
    const subtitleAlpha = 0.35 + 0.25 * Math.sin(this.animTime * 1.8);
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.shadow, subtitleAlpha);
    ctx.fillText('A game of space strategy', cx, titleY + 56);

    // Menu options
    this.drawOptions(ctx, cx, screenH * 0.52, TITLE_OPTIONS);

    // Bottom: version / hint bar
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.35);
    ctx.fillText('TypeScript Port  |  Press ENTER to play', cx, screenH - 18);
  }

  private drawPauseMenu(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
  ): void {
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, screenW, screenH);

    const cx = screenW * 0.5;
    const headerY = screenH * 0.35;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "PAUSED" header with underline
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.title);
    ctx.fillText('PAUSED', cx, headerY);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.5);
    ctx.lineWidth = 1;
    const tw = ctx.measureText('PAUSED').width;
    ctx.beginPath();
    ctx.moveTo(cx - tw * 0.5, headerY + 22);
    ctx.lineTo(cx + tw * 0.5, headerY + 22);
    ctx.stroke();

    // Options
    this.drawOptions(ctx, cx, screenH * 0.5, PAUSE_OPTIONS);
  }

  private drawOptions(
    ctx: CanvasRenderingContext2D,
    cx: number,
    startY: number,
    options: MenuOption[],
  ): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineH = 40;

    for (let i = 0; i < options.length; i++) {
      const y = startY + i * lineH;
      const selected = i === this.selectedIndex;

      if (selected) {
        // Highlight bar
        const barW = 280;
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.12);
        ctx.fillRect(cx - barW * 0.5, y - lineH * 0.45, barW, lineH * 0.9);

        // Left/right chevron decorations
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.9);
        ctx.font = '18px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('>', cx - 120, y);
        ctx.textAlign = 'right';
        ctx.fillText('<', cx + 120, y);

        ctx.textAlign = 'center';
        ctx.font = 'bold 18px "Courier New", monospace';
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status);
        ctx.fillText(options[i].label, cx, y);

        // Description line
        if (options[i].description) {
          ctx.font = '11px "Courier New", monospace';
          ctx.fillStyle = colorToCSS(TextColors.shadow, 0.7);
          ctx.fillText(options[i].description ?? '', cx, y + 22);
        }
      } else {
        ctx.font = '18px "Courier New", monospace';
        ctx.fillStyle = colorToCSS(TextColors.normal, 0.55);
        ctx.textAlign = 'center';
        ctx.fillText(options[i].label, cx, y);
      }
    }

    // Navigation hint
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(TextColors.shadow, 0.4);
    ctx.textAlign = 'center';
    ctx.fillText(
      '\u2191 \u2193  Navigate    Enter  Select',
      cx,
      startY + options.length * lineH + 24,
    );
  }
}

