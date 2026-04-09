/** Heads-up display for Gate88 — minimal, message-based */

import { Colors, colorToCSS, Color } from './colors.js';

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
const MESSAGE_LINE_HEIGHT = 18;

// ---------------------------------------------------------------------------
// HUD class
// ---------------------------------------------------------------------------

export class HUD {
  private messages: HudMessage[] = [];

  /** Queue a new message to display. */
  showMessage(text: string, color: Color = Colors.general_building, duration: number = DEFAULT_DURATION): void {
    if (this.messages.length >= MAX_MESSAGES) {
      this.messages.shift();
    }
    this.messages.push({ text, color, timeLeft: duration, duration });
  }

  update(dt: number): void {
    for (const msg of this.messages) {
      msg.timeLeft -= dt;
    }
    this.messages = this.messages.filter((m) => m.timeLeft > 0);
  }

  draw(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (this.messages.length === 0) return;

    ctx.font = '13px "Courier New", monospace';
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

  /** Draw the resource count display at the bottom of the screen. */
  drawResources(
    ctx: CanvasRenderingContext2D,
    resources: number,
    screenW: number,
    screenH: number,
  ): void {
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.6);
    ctx.fillText(`$${Math.floor(resources)}`, screenW - 10, screenH - 10);
  }

  /** Draw the player energy/battery indicator at the bottom-left. */
  drawPlayerEnergy(
    ctx: CanvasRenderingContext2D,
    battery: number,
    maxBattery: number,
    screenW: number,
    screenH: number,
  ): void {
    const frac = Math.max(0, Math.min(1, battery / maxBattery));
    const barW = 80;
    const barH = 7;
    const x = 10;
    const y = screenH - 24;

    // Label
    ctx.font = '10px "Courier New", monospace';
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
      const flash = frac < 0.15 ? 0.5 + 0.5 * Math.sin(Date.now() * 0.01) : 1;
      barColor = colorToCSS(Colors.alert1, 0.9 * flash);
      labelColor = colorToCSS(Colors.alert1, 0.9 * flash);
    }

    ctx.fillStyle = labelColor;
    ctx.fillText('ENERGY', x, y - barH - 2);

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
}
