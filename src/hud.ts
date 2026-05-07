/** Heads-up display for Gate88 — minimal, message-based */

import { Colors, colorToCSS, Color } from './colors.js';
import { getBuildDef } from './builddefs.js';

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
// HUD class
// ---------------------------------------------------------------------------

export class HUD {
  private messages: HudMessage[] = [];
  private animTime: number = 0;

  /** Queue a new message to display. */
  showMessage(text: string, color: Color = Colors.general_building, duration: number = DEFAULT_DURATION): void {
    if (this.messages.length >= MAX_MESSAGES) {
      this.messages.shift();
    }
    this.messages.push({ text, color, timeLeft: duration, duration });
  }

  update(dt: number): void {
    this.animTime += dt;
    for (const msg of this.messages) {
      msg.timeLeft -= dt;
    }
    this.messages = this.messages.filter((m) => m.timeLeft > 0);
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

  /** Draw the resource count display at the bottom of the screen. */
  drawResources(
    ctx: CanvasRenderingContext2D,
    resources: number,
    incomePerSecond: number,
    screenW: number,
    screenH: number,
  ): void {
    ctx.font = `${HUD_FONT_SIZE}px "Poiret One", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.6);
    ctx.fillText(`(+${Math.round(incomePerSecond)}/sec)`, screenW - 10, screenH - 44);
    ctx.fillText(`$${Math.floor(resources)}`, screenW - 10, screenH - 10);
  }

  /** Draw the selected-build slot just above the energy bar (bottom-left). */
  drawSelectedBuild(
    ctx: CanvasRenderingContext2D,
    buildType: string | null,
    resources: number,
    _screenW: number,
    screenH: number,
  ): void {
    // Label sits just above the ENERGY label drawn by drawPlayerEnergy.
    const x = 10;
    const y = screenH - 92;

    ctx.font = `${HUD_FONT_SIZE}px "Poiret One", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    if (!buildType) {
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.32);
      ctx.fillText('No Build Selection', x, y);
      return;
    }

    const def = getBuildDef(buildType);
    const cost = def?.cost ?? 0;
    const displayName = def?.label ?? buildType;
    const canAfford = resources >= cost;

    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.45);
    ctx.fillText('BUILD:', x, y - 34);
    ctx.fillStyle = canAfford
      ? colorToCSS(Colors.general_building, 0.85)
      : colorToCSS(Colors.alert1, 0.8);
    ctx.fillText(`${displayName}  $${cost}`, x, y);
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
    const barW = 220;
    const barH = 14;
    const x = 10;
    const y = screenH - 24;

    // Label
    ctx.font = `${HUD_FONT_SIZE}px "Poiret One", sans-serif`;
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
      const pct = Math.floor((current.progress / Math.max(1, current.timeNeeded)) * 100);
      const secsLeft = Math.max(0, Math.ceil(current.timeNeeded - current.progress));
      ctx.fillText(`${secsLeft} sec`, x, y - 34);
      ctx.fillText(`Research: ${current.item} ${pct}%`, x, y);
    } else if (completedCount > 0) {
      ctx.fillText(`Research complete: ${completedCount}`, x, y);
    }
  }
}
