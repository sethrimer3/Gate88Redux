/** Heads-up display for Gate88 — minimal, message-based */

import { Colors, colorToCSS, Color } from './colors.js';
import { gameFont, menuFont } from './fonts.js';

// ---------------------------------------------------------------------------
// HUD message
// ---------------------------------------------------------------------------

interface HudMessage {
  text: string;
  color: Color;
  /** Time remaining before the message is removed (seconds). */
  timeLeft: number;
  /** Total display time, used to compute fade. */
  duration: number;
}

const FADE_IN_TIME = 0.3;
const FADE_OUT_TIME = 0.8;
const DEFAULT_DURATION = 4.0;
const MAX_MESSAGES = 5;
const HUD_FONT_SIZE = 30;
const MESSAGE_LINE_HEIGHT = 34;

// ---------------------------------------------------------------------------
// AI chat panel — narrates AI thinking in a smaller panel on the right side
// ---------------------------------------------------------------------------

interface AIChatEntry {
  prefix: string;
  text: string;
  /** Color for the prefix badge (e.g. enemy red or allied cyan). */
  prefixColor: Color;
  timeLeft: number;
  duration: number;
}

const CHAT_FONT_SIZE = 18;
const CHAT_LINE_HEIGHT = 22;
const CHAT_MAX_ENTRIES = 5;
const CHAT_DEFAULT_DURATION = 8.0;
const CHAT_FADE_OUT = 1.2;

// ---------------------------------------------------------------------------
// HUD class
// ---------------------------------------------------------------------------

export class HUD {
  private messages: HudMessage[] = [];
  private animTime: number = 0;
  private chatEntries: AIChatEntry[] = [];

  /** Queue a new message to display. */
  showMessage(text: string, color: Color = Colors.general_building, duration: number = DEFAULT_DURATION): void {
    if (this.messages.length >= MAX_MESSAGES) {
      this.messages.shift();
    }
    this.messages.push({ text, color, timeLeft: duration, duration });
  }

  /**
   * Post an AI commentary line to the chat panel in the lower-right.
   *
   * @param prefix  Short badge like "RIVAL" or "BASE" — shown in prefixColor.
   * @param text    The message body.
   * @param prefixColor  Color for the badge text.
   * @param duration  How long the message stays visible (default 8 s).
   */
  showAIChat(
    prefix: string,
    text: string,
    prefixColor: Color = Colors.general_building,
    duration: number = CHAT_DEFAULT_DURATION,
  ): void {
    if (this.chatEntries.length >= CHAT_MAX_ENTRIES) {
      this.chatEntries.shift();
    }
    this.chatEntries.push({ prefix, text, prefixColor, timeLeft: duration, duration });
  }

  update(dt: number): void {
    this.animTime += dt;
    for (const msg of this.messages) {
      msg.timeLeft -= dt;
    }
    this.messages = this.messages.filter((m) => m.timeLeft > 0);
    for (const e of this.chatEntries) {
      e.timeLeft -= dt;
    }
    this.chatEntries = this.chatEntries.filter((e) => e.timeLeft > 0);
  }

  draw(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (this.messages.length === 0) return;

    ctx.font = `${HUD_FONT_SIZE}px "Poiret One", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const baseY = screenH * 0.25;

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      const elapsed = msg.duration - msg.timeLeft;

      // Compute alpha with fade-in and fade-out
      let alpha: number;
      if (elapsed < FADE_IN_TIME) {
        alpha = elapsed / FADE_IN_TIME;
      } else if (msg.timeLeft < FADE_OUT_TIME) {
        alpha = msg.timeLeft / FADE_OUT_TIME;
      } else {
        alpha = 1;
      }

      const y = baseY + i * MESSAGE_LINE_HEIGHT;
      ctx.fillStyle = colorToCSS(msg.color, alpha);
      ctx.fillText(msg.text, screenW * 0.5, y);
    }
  }

  /**
   * Draw the AI chat panel — a small log of AI commentary in the
   * lower-right of the screen, above the resource counter.
   *
   * Each line has a colored prefix badge (e.g. "[RIVAL]") followed by
   * the message body in a dimmer neutral color.  Lines fade out gradually
   * as they age.
   */
  drawAIChat(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (this.chatEntries.length === 0) return;

    ctx.font = `${CHAT_FONT_SIZE}px "Poiret One", sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';

    const rightX = screenW - 12;
    // Start just above the resources line (which is ~44px from bottom for
    // income text + another ~34px for the resource value).
    const bottomY = screenH - 90;

    for (let i = this.chatEntries.length - 1; i >= 0; i--) {
      const entry = this.chatEntries[i];
      const age = entry.duration - entry.timeLeft;
      let alpha: number;
      if (age < 0.25) {
        alpha = age / 0.25;
      } else if (entry.timeLeft < CHAT_FADE_OUT) {
        alpha = entry.timeLeft / CHAT_FADE_OUT;
      } else {
        alpha = 1;
      }
      // Older lines are dimmer to distinguish from recent ones.
      const lineIndex = this.chatEntries.length - 1 - i; // 0 = newest
      const ageDim = Math.max(0.35, 1.0 - lineIndex * 0.12);

      const y = bottomY - lineIndex * CHAT_LINE_HEIGHT;

      // Message body (right-aligned, drawn first so prefix can overdraw)
      ctx.fillStyle = colorToCSS(Colors.general_building, alpha * ageDim * 0.7);
      ctx.fillText(entry.text, rightX, y);

      // Measure body width so we can place the prefix to the left of it
      const bodyW = ctx.measureText(entry.text).width;
      const prefixStr = `[${entry.prefix}] `;
      ctx.fillStyle = colorToCSS(entry.prefixColor, alpha * ageDim);
      ctx.fillText(prefixStr, rightX - bodyW, y);
    }
  }

  /** Draw the resource count display at the bottom of the screen. */
  drawResources(
    ctx: CanvasRenderingContext2D,
    resources: number,
    incomePerSecond: number,
    screenW: number,
    screenH: number,
    options: { currencySymbol?: string; symbolOnRight?: boolean; symbolFont?: 'menu' | 'main' } = {},
  ): void {
    ctx.font = options.symbolFont === 'menu' ? menuFont(HUD_FONT_SIZE) : gameFont(HUD_FONT_SIZE);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.6);
    ctx.fillText(`(+${Math.round(incomePerSecond)}/sec)`, screenW - 10, screenH - 44);
    const symbol = options.currencySymbol ?? '$';
    const amount = Math.floor(resources);
    ctx.fillText(options.symbolOnRight ? `${amount} ${symbol}` : `${symbol}${amount}`, screenW - 10, screenH - 10);
  }

  /** Draw the player energy/battery indicator at the bottom-left. */
  drawPlayerEnergy(
    ctx: CanvasRenderingContext2D,
    battery: number,
    maxBattery: number,
    health: number,
    maxHealth: number,
    screenW: number,
    screenH: number,
  ): void {
    const frac = Math.max(0, Math.min(1, battery / maxBattery));
    const hpFrac = Math.max(0, Math.min(1, health / maxHealth));
    const barW = 220;
    const barH = 14;
    const x = 10;
    const y = screenH - 24;

    // Label
    ctx.font = `${Math.floor(HUD_FONT_SIZE * 0.5)}px "Poiret One", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    let barColor: string;
    let labelColor: string;
    if (frac > 0.6) {
      barColor = colorToCSS(Colors.radar_friendly_status, 0.85);
      labelColor = colorToCSS(Colors.general_building, 0.6);
    } else if (frac > 0.3) {
      barColor = colorToCSS(Colors.alert2, 0.9);
      labelColor = colorToCSS(Colors.alert2, 0.8);
    } else {
      const flash = frac < 0.15 ? 0.5 + 0.5 * Math.sin(this.animTime * 10) : 1;
      barColor = colorToCSS(Colors.alert1, 0.9 * flash);
      labelColor = colorToCSS(Colors.alert1, 0.9 * flash);
    }

    ctx.fillStyle = labelColor;
    ctx.fillText('ENERGY', x, y - barH - 8);

    const hpY = y - barH - 30;
    ctx.fillStyle = colorToCSS(Colors.healthbar, 0.9);
    ctx.fillText('HP', x, hpY - barH - 6);
    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.2);
    ctx.fillRect(x, hpY - barH, barW, barH);
    ctx.fillStyle = colorToCSS(Colors.healthbar, 0.86);
    ctx.fillRect(x, hpY - barH, barW * hpFrac, barH);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, hpY - barH, barW, barH);

    // Background track
    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.2);
    ctx.fillRect(x, y - barH, barW, barH);

    // Filled portion
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y - barH, barW * frac, barH);

    // Border
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - barH, barW, barH);
  }

  /**
   * PR5: warn the player about disconnected (unpowered) buildings. Drawn
   * just above the ENERGY/BUILD column so it stays in the same eye-line.
   */
  drawPowerStatus(
    ctx: CanvasRenderingContext2D,
    unpoweredCount: number,
    screenH: number,
  ): void {
    if (unpoweredCount <= 0) return;
    const x = 10;
    const y = screenH - 142;
    const flash = 0.5 + 0.5 * Math.sin(this.animTime * 5);
    ctx.font = `${HUD_FONT_SIZE}px "Poiret One", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.5 + 0.5 * flash);
    const label =
      unpoweredCount === 1
        ? '1 building unpowered'
        : `${unpoweredCount} buildings unpowered`;
    ctx.fillText(`⚠ ${label}`, x, y);
  }

  drawResearchStatus(
    ctx: CanvasRenderingContext2D,
    current: { item: string | null; progress: number; timeNeeded: number },
    completedCount: number,
    screenH: number,
  ): void {
    const x = 10;
    const y = screenH - 204;
    ctx.font = `${HUD_FONT_SIZE}px "Poiret One", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = colorToCSS(Colors.researchlab_detail, 0.75);
    if (current.item) {
      const secsLeft = Math.max(0, Math.ceil(current.timeNeeded - current.progress));
      ctx.fillText(`${secsLeft} sec`, x, y - 34);
    }
  }
}
