/**
 * Fighter control group status UI.
 *
 * Draws compact boxes on the left side of the screen showing which ship types
 * are assigned to each numbered control group and command-mode category
 * (follow-player / protect-base), with alive/assigned counts per type.
 *
 * No external sprite assets are used.  Icon shapes are extracted directly from
 * the same vertex math used by the in-world ship/building draw methods.
 */

import { Colors, colorToCSS } from './colors.js';
import { EntityType, ShipGroup, Team } from './entities.js';
import { BomberShip, FighterShip, SynonymousFighterShip, SynonymousNovaBomberShip } from './fighter.js';
import { teamColor } from './teamutils.js';
import type { GameState } from './gamestate.js';

// ---------------------------------------------------------------------------
// Icon type classification
// ---------------------------------------------------------------------------

type IconType = 'fighter' | 'bomber' | 'synonymous_fighter' | 'synonymous_nova_bomber';

function getIconType(f: FighterShip): IconType {
  if (f instanceof SynonymousNovaBomberShip) return 'synonymous_nova_bomber';
  if (f instanceof SynonymousFighterShip) return 'synonymous_fighter';
  if (f.type === EntityType.Bomber) return 'bomber';
  return 'fighter';
}

/** Canonical order in which icon types are displayed inside a box. */
const ICON_TYPE_ORDER: IconType[] = ['fighter', 'synonymous_fighter', 'bomber', 'synonymous_nova_bomber'];

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Inner horizontal padding on each side of a box. */
const BOX_PAD = 5;
/** Width of each ship-type icon cell (icons are centred within). */
const ICON_CELL_W = 28;
/** Radius used when drawing ship icons. */
const ICON_R = 8;
/** Height of the icon row (2 × ICON_R with a little clearance). */
const ICON_ROW_H = 20;
/** Height of the count label row below the icons. */
const COUNT_ROW_H = 13;
/** Total height of a status box. */
const BOX_H = BOX_PAD + ICON_ROW_H + 3 + COUNT_ROW_H + BOX_PAD;
/** Vertical gap between successive boxes. */
const BOX_GAP = 4;
/** Screen X position of the left edge of all boxes. */
const BOX_X = 10;
/** Screen Y position of the top edge of the first box. */
const BOX_START_Y = 50;
/** Width of the badge area (group number / mode icon) on the right side of the box. */
const BADGE_W = 20;
/** How long (seconds) a zero-alive group stays visible before disappearing. */
const RESET_DELAY_SECS = 8;

// ---------------------------------------------------------------------------
// Glass panel (matches the style in hud.ts)
// ---------------------------------------------------------------------------

const HUD_CYAN = 'rgba(118,242,255,';
const HUD_GOLD = 'rgba(255,218,116,';

function drawGlassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
): void {
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, `rgba(4,18,31,${0.46 * alpha})`);
  fill.addColorStop(0.58, HUD_CYAN + `${0.06 * alpha})`);
  fill.addColorStop(1, `rgba(2,8,18,${0.60 * alpha})`);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = HUD_CYAN + `${0.35 * alpha})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeStyle = HUD_GOLD + `${0.18 * alpha})`;
  ctx.beginPath();
  ctx.moveTo(x + 5, y + h - 0.5);
  ctx.lineTo(x + Math.min(w * 0.40, 60), y + h - 0.5);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Miniature icon renderers
// All icons are drawn facing right (+x direction, angle=0) at a given
// centre (cx, cy) and scaled by radius r.  These replicate the vertex
// shapes used in ship.ts / fighter.ts / building.ts.
// ---------------------------------------------------------------------------

function drawFighterIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const color = teamColor(Team.Player);
  ctx.save();
  ctx.translate(cx, cy);
  // Triangle body – same vertices as FighterShip.draw() (player variant, no wings)
  ctx.strokeStyle = colorToCSS(color, 0.85);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(r * 1.2, 0);
  ctx.lineTo(-r * 0.6, -r * 0.6);
  ctx.lineTo(-r * 0.3, 0);
  ctx.lineTo(-r * 0.6, r * 0.6);
  ctx.closePath();
  ctx.stroke();
  // Centre core dot
  ctx.fillStyle = colorToCSS(color, 0.70);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBomberIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const color = teamColor(Team.Player);
  ctx.save();
  ctx.translate(cx, cy);
  // Diamond body – same vertices as BomberShip.draw()
  ctx.strokeStyle = colorToCSS(Colors.bullet_player_cannon, 0.85);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(r * 1.0, 0);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(-r * 0.8, 0);
  ctx.lineTo(0, r * 0.7);
  ctx.closePath();
  ctx.stroke();
  // Centre core dot
  ctx.fillStyle = colorToCSS(color, 0.70);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSynonymousFighterIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Hexagonal core + three drone dots – matches SynonymousFighterShip.draw()
  const color = teamColor(Team.Player);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';
  // Hexagon
  const hexR = r * 0.5;
  ctx.strokeStyle = colorToCSS(color, 0.52);
  ctx.lineWidth = Math.max(0.7, 0.8);
  ctx.beginPath();
  for (let j = 0; j < 6; j++) {
    const a = j * Math.PI / 3;
    if (j === 0) ctx.moveTo(Math.cos(a) * hexR, Math.sin(a) * hexR);
    else ctx.lineTo(Math.cos(a) * hexR, Math.sin(a) * hexR);
  }
  ctx.closePath();
  ctx.stroke();
  // Three drone dots arranged in a triangular pattern, facing right
  const nodeR = Math.max(1.5, r * 0.22);
  const positions: [number, number][] = [
    [r * 0.75, 0],
    [-r * 0.42, -r * 0.5],
    [-r * 0.42, r * 0.5],
  ];
  ctx.fillStyle = colorToCSS(color, 0.82);
  for (const [px, py] of positions) {
    ctx.beginPath();
    ctx.arc(px, py, nodeR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSynonymousNovaBomberIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Arc segments ring – compact version of SynonymousNovaBomberShip.draw()
  const color = teamColor(Team.Player);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';
  const segCount = 5;
  const arcR = r * 0.82;
  ctx.strokeStyle = colorToCSS(color, 0.72);
  ctx.lineWidth = 1.0;
  for (let i = 0; i < segCount; i++) {
    const startA = (i * Math.PI * 2 / segCount) - Math.PI / 2;
    const endA = startA + (Math.PI * 2 / segCount) - 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, arcR, startA, endA);
    ctx.stroke();
  }
  // Centre glow dot
  ctx.fillStyle = colorToCSS(color, 0.60);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Miniature player ship – same arrow/triangle body as PlayerShip.draw(),
 * drawn facing right at the icon's (cx, cy).
 */
function drawPlayerShipBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const color = teamColor(Team.Player);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(20, 36, 32, 0.72)';
  ctx.beginPath();
  ctx.moveTo(r * 1.4, 0);
  ctx.lineTo(-r, -r * 0.7);
  ctx.lineTo(-r * 0.5, 0);
  ctx.lineTo(-r, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = colorToCSS(color, 0.90);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(r * 1.4, 0);
  ctx.lineTo(-r, -r * 0.7);
  ctx.lineTo(-r * 0.5, 0);
  ctx.lineTo(-r, r * 0.7);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Miniature command-post / base icon – simplified square body with a cross
 * antenna and a radar-blip dot, matching the visual language of CommandPost.draw().
 */
function drawBaseBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const s = r * 1.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = colorToCSS(Colors.general_building, 0.78);
  ctx.lineWidth = 1;
  ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
  // Cross antenna lines
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.44);
  ctx.lineTo(0, s * 0.44);
  ctx.moveTo(-s * 0.44, 0);
  ctx.lineTo(s * 0.44, 0);
  ctx.stroke();
  // Radar blip dot
  ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.70);
  ctx.beginPath();
  ctx.arc(s * 0.20, -s * 0.20, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function drawShipIcon(
  ctx: CanvasRenderingContext2D,
  iconType: IconType,
  cx: number,
  cy: number,
): void {
  switch (iconType) {
    case 'fighter': drawFighterIcon(ctx, cx, cy, ICON_R); break;
    case 'bomber': drawBomberIcon(ctx, cx, cy, ICON_R); break;
    case 'synonymous_fighter': drawSynonymousFighterIcon(ctx, cx, cy, ICON_R); break;
    case 'synonymous_nova_bomber': drawSynonymousNovaBomberIcon(ctx, cx, cy, ICON_R); break;
  }
}

// ---------------------------------------------------------------------------
// Group entry (data for one ship type within a box)
// ---------------------------------------------------------------------------

interface GroupEntry {
  iconType: IconType;
  alive: number;
  assigned: number;
}

// ---------------------------------------------------------------------------
// FighterGroupStatusUI class
// ---------------------------------------------------------------------------

export class FighterGroupStatusUI {
  /**
   * Per-key assigned counts: key = `"<prefix>:<iconType>"`.
   * Updated each `update()` call as the running maximum alive count seen.
   */
  private readonly assignedCounts = new Map<string, number>();
  /**
   * Tracks how long (seconds) a key has had zero alive fighters.
   * When this exceeds RESET_DELAY_SECS the entry is cleared from assignedCounts.
   */
  private readonly zeroSince = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Update assigned-count tracking.  Call once per fixed tick (dt = DT).
   * This must be called *after* the fighter list has been pruned of dead ships
   * so that alive counts are current.
   */
  update(state: GameState, dt: number): void {
    const playerFighters = state.fighters.filter((f) => f.alive && f.team === Team.Player);

    // Numbered groups
    for (let g = 0; g <= 2; g++) {
      this.updateForFilter(playerFighters, (f) => f.group === g, `group:${g}`, dt);
    }

    // Command-mode categories
    this.updateForFilter(playerFighters, (f) => f.order === 'follow', 'follow', dt);
    this.updateForFilter(playerFighters, (f) => f.order === 'protect', 'protect', dt);
  }

  /**
   * Draw all active status boxes.
   * @param animTime  Running time in seconds, used for subtle pulse animations.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    _screenW: number,
    _screenH: number,
    animTime: number,
  ): void {
    const playerFighters = state.fighters.filter((f) => f.alive && f.team === Team.Player);
    let boxY = BOX_START_Y;

    // --- Numbered groups ---
    for (let g = 0; g <= 2; g++) {
      const entries = this.computeEntries(playerFighters, (f) => f.group === g, `group:${g}`);
      if (entries.length === 0) continue;
      boxY = this.drawBox(ctx, entries, boxY, g, null, animTime) + BOX_GAP;
    }

    // --- Follow-player box ---
    const followEntries = this.computeEntries(playerFighters, (f) => f.order === 'follow', 'follow');
    if (followEntries.length > 0) {
      boxY = this.drawBox(ctx, followEntries, boxY, null, 'follow', animTime) + BOX_GAP;
    }

    // --- Protect-base box ---
    const protectEntries = this.computeEntries(playerFighters, (f) => f.order === 'protect', 'protect');
    if (protectEntries.length > 0) {
      this.drawBox(ctx, protectEntries, boxY, null, 'protect', animTime);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private updateForFilter(
    fighters: FighterShip[],
    filter: (f: FighterShip) => boolean,
    prefix: string,
    dt: number,
  ): void {
    // Count alive fighters by icon type for this filter
    const aliveCounts = new Map<IconType, number>();
    for (const f of fighters) {
      if (!filter(f)) continue;
      const t = getIconType(f);
      aliveCounts.set(t, (aliveCounts.get(t) ?? 0) + 1);
    }

    for (const iconType of ICON_TYPE_ORDER) {
      const key = `${prefix}:${iconType}`;
      const alive = aliveCounts.get(iconType) ?? 0;
      const prev = this.assignedCounts.get(key) ?? 0;
      const assigned = Math.max(prev, alive);

      if (assigned === 0) continue; // never had any fighters of this type

      this.assignedCounts.set(key, assigned);

      if (alive === 0) {
        const z = (this.zeroSince.get(key) ?? 0) + dt;
        this.zeroSince.set(key, z);
        if (z > RESET_DELAY_SECS) {
          this.assignedCounts.delete(key);
          this.zeroSince.delete(key);
        }
      } else {
        this.zeroSince.delete(key);
      }
    }
  }

  /**
   * Build the list of GroupEntry objects for a box, using current alive counts
   * and the persisted assigned counts.
   */
  private computeEntries(
    fighters: FighterShip[],
    filter: (f: FighterShip) => boolean,
    prefix: string,
  ): GroupEntry[] {
    const aliveCounts = new Map<IconType, number>();
    for (const f of fighters) {
      if (!filter(f)) continue;
      const t = getIconType(f);
      aliveCounts.set(t, (aliveCounts.get(t) ?? 0) + 1);
    }

    const entries: GroupEntry[] = [];
    for (const iconType of ICON_TYPE_ORDER) {
      const key = `${prefix}:${iconType}`;
      const assigned = this.assignedCounts.get(key) ?? 0;
      if (assigned === 0) continue;
      const alive = aliveCounts.get(iconType) ?? 0;
      entries.push({ iconType, alive, assigned });
    }
    return entries;
  }

  /**
   * Draw a single status box and return the Y coordinate of its bottom edge.
   *
   * @param groupNum   0/1/2 for a numbered group, null for a mode box.
   * @param mode       'follow' | 'protect' | null.
   */
  private drawBox(
    ctx: CanvasRenderingContext2D,
    entries: GroupEntry[],
    y: number,
    groupNum: number | null,
    mode: 'follow' | 'protect' | null,
    animTime: number,
  ): number {
    const n = entries.length;
    const innerW = BOX_PAD + n * ICON_CELL_W + BOX_PAD;
    const totalW = innerW + BADGE_W;
    const x = BOX_X;

    // --- Determine fade alpha based on alive counts ---
    const totalAlive = entries.reduce((s, e) => s + e.alive, 0);
    const alpha = totalAlive === 0
      ? 0.45 + 0.15 * Math.sin(animTime * 3.5)   // pulse gently when all dead
      : 1.0;

    // Glass panel background
    ctx.save();
    drawGlassPanel(ctx, x, y, totalW, BOX_H, 0.82 * alpha);

    // === Icon row ===
    const iconCY = y + BOX_PAD + ICON_ROW_H * 0.5;

    for (let i = 0; i < n; i++) {
      const entry = entries[i];
      const iconCX = x + BOX_PAD + i * ICON_CELL_W + ICON_CELL_W * 0.5;
      const iconAlpha = entry.alive === 0 ? 0.35 : 1.0;
      ctx.globalAlpha = iconAlpha * alpha;
      drawShipIcon(ctx, entry.iconType, iconCX, iconCY);
      ctx.globalAlpha = 1;

      // === Count label (alive/assigned) ===
      const countY = y + BOX_PAD + ICON_ROW_H + 5;
      const label = entry.assigned > 0 ? `${entry.alive}/${entry.assigned}` : `${entry.alive}`;
      const countColor = entry.alive === 0
        ? colorToCSS(Colors.alert1, 0.75 * alpha)
        : colorToCSS(Colors.general_building, 0.82 * alpha);
      ctx.font = '9px "Poiret One", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = countColor;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillText(label, iconCX, countY);
    }

    // === Badge area (top-right corner of box) ===
    ctx.globalAlpha = alpha;
    const badgeCX = x + innerW + BADGE_W * 0.5;
    const badgeCY = y + BOX_H * 0.5;

    if (groupNum !== null) {
      // Numbered group: draw the group number as text
      const groupColors = [Colors.redgroup, Colors.greengroup, Colors.bluegroup];
      const groupColor = groupColors[groupNum] ?? Colors.general_building;
      ctx.font = `bold 11px "Poiret One", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colorToCSS(groupColor, 0.92 * alpha);
      ctx.shadowColor = colorToCSS(groupColor, 0.55 * alpha);
      ctx.shadowBlur = 6;
      ctx.fillText(`${groupNum + 1}`, badgeCX, badgeCY);
      ctx.shadowBlur = 0;
    } else if (mode === 'follow') {
      // Player ship icon as badge
      drawPlayerShipBadge(ctx, badgeCX, badgeCY, 5.5);
    } else if (mode === 'protect') {
      // Base/command-post icon as badge
      drawBaseBadge(ctx, badgeCX, badgeCY, 5.5);
    }

    // Divider line between icon area and badge area
    ctx.globalAlpha = 0.28 * alpha;
    ctx.strokeStyle = HUD_CYAN + '1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + innerW, y + 4);
    ctx.lineTo(x + innerW, y + BOX_H - 4);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.restore();

    return y + BOX_H;
  }
}
