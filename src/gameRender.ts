import { Camera } from './camera.js';
import { Colors, colorToCSS, type Color } from './colors.js';
import { EntityType, ShipGroup, Team } from './entities.js';
import type { GameState } from './gamestate.js';
import type { LanClient } from './lan/lanClient.js';
import { Vec2 } from './math.js';
import { recentCombatAimSamples } from './targeting.js';
import { getShipPathDebugStats } from './shippath.js';

export type ShipCommandGroup = ShipGroup | 'all';
export type WaypointMarker = { pos: Vec2; issuedAt: number };

const GROUP_COLORS: Record<ShipGroup, Color> = {
  [ShipGroup.Red]: Colors.redgroup,
  [ShipGroup.Green]: Colors.greengroup,
  [ShipGroup.Blue]: Colors.bluegroup,
};

export function drawWaypointMarkers(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: GameState,
  waypointMarkers: Map<ShipCommandGroup, WaypointMarker>,
): void {
  const drawOrder: ShipCommandGroup[] = [ShipGroup.Red, ShipGroup.Green, ShipGroup.Blue, 'all'];
  for (const group of drawOrder) {
    const marker = waypointMarkers.get(group);
    if (!marker) continue;
    const screen = camera.worldToScreen(marker.pos);
    const color = group === 'all' ? Colors.alert2 : GROUP_COLORS[group];
    const label = group === 'all' ? 'A' : `${group + 1}`;
    const t = state.gameTime - marker.issuedAt;
    const phase = state.gameTime * 3.2 + (group === 'all' ? 1.8 : group);
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    const ring = (18 + pulse * 6) * camera.zoom;
    const lift = Math.sin(state.gameTime * 1.7 + t) * 3 * camera.zoom;

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
      ctx.rotate(state.gameTime * (0.9 + i * 0.23) + i * Math.PI * 0.66);
      ctx.strokeStyle = colorToCSS(color, 0.45 - i * 0.08);
      ctx.lineWidth = Math.max(1, 1.4 * camera.zoom);
      ctx.beginPath();
      ctx.ellipse(0, 0, ring * (1 + i * 0.26), ring * (0.42 + i * 0.12), 0, 0.18, Math.PI * 1.72);
      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = colorToCSS(color, 0.76);
    ctx.lineWidth = Math.max(1, 1.2 * camera.zoom);
    ctx.beginPath();
    ctx.moveTo(0, -ring * 0.9);
    ctx.lineTo(ring * 0.7, 0);
    ctx.lineTo(0, ring * 0.9);
    ctx.lineTo(-ring * 0.7, 0);
    ctx.closePath();
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `bold ${Math.max(9, 12 * camera.zoom)}px "Poiret One", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorToCSS(Colors.particles_switch, 0.92);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

export function drawDebugOverlay(ctx: CanvasRenderingContext2D, args: {
  screenW: number;
  state: GameState;
  lastFrameMs: number;
  lanClient: LanClient | null;
  lanMySlot: number;
  lanLastSnapshotSeq: number;
  lanSnapshotSeq: number;
  lanAiDirectorCount: number;
  /** Current prediction error magnitude (px) for the local player ship. */
  lanPredictionError?: number;
}): void {
  const { state } = args;
  const playerBuildings = state.buildings.filter((b) => b.alive && b.team === Team.Player);
  const enemyBuildings = state.buildings.filter((b) => b.alive && b.team === Team.Enemy);
  const powered = playerBuildings.filter((b) => b.buildProgress >= 1 && b.powered).length;
  const unpowered = playerBuildings.filter((b) => b.buildProgress >= 1 && !b.powered).length;
  const research = state.researchProgress.item
    ? `${state.researchProgress.item} ${Math.floor(
        (state.researchProgress.progress / Math.max(1, state.researchProgress.timeNeeded)) * 100,
      )}%`
    : 'none';
  const groups = [ShipGroup.Red, ShipGroup.Green, ShipGroup.Blue]
    .map((g) => `${g + 1} ${state.getFighterGroupCounts(Team.Player, g).total}`)
    .join(' / ');

  const lines = [
    `mode ${state.gameMode}  frame ${args.lastFrameMs.toFixed(1)}ms`,
    `resources ${Math.floor(state.resources)}  build ${state.selectedBuildType ?? 'none'}`,
    `ship hp ${Math.ceil(state.player.health)}/${state.player.maxHealth}  battery ${Math.floor(state.player.battery)}/${state.player.maxBattery}`,
    `buildings player ${playerBuildings.length} enemy ${enemyBuildings.length}`,
    `conduits ${state.grid.conduitCount()} pending ${state.grid.pendingConduitCount()}`,
    `power player ${powered} powered / ${unpowered} unpowered`,
    `research ${research}`,
    `fighters ${groups}`,
  ];

  const pathStats = getShipPathDebugStats();
  const ai = state.aiDebug;
  if (ai) {
    const retreat = ai.retreatTarget ? `${Math.round(ai.retreatTarget.x)},${Math.round(ai.retreatTarget.y)}` : 'none';
    const cached = ai.cachedNavigationTarget ? `${Math.round(ai.cachedNavigationTarget.x)},${Math.round(ai.cachedNavigationTarget.y)}` : 'none';
    lines.push(`AI goal ${ai.goal}  hp ${(ai.healthFraction * 100).toFixed(0)}%`);
    lines.push(`AI retreat ${retreat}  adjusted ${ai.retreatTargetAdjusted ? 'yes' : 'no'}`);
    lines.push(`AI nav cache ${cached}`);
  }
  lines.push(`ship paths ${pathStats.resolvesPerSecond}/s  avg ${pathStats.avgMsLast60.toFixed(2)}ms max ${pathStats.maxMsLast60.toFixed(2)}ms`);
  lines.push(`ship path target adjusted ${pathStats.adjustedTargetLastSecond ? 'yes' : 'no'}`);

  const isLan = state.gameMode === 'lan_host' || state.gameMode === 'lan_client';
  if (isLan && args.lanClient) {
    const role = state.gameMode === 'lan_host' ? 'host' : 'client';
    lines.push(`LAN ${role}  slot ${args.lanMySlot + 1}  ping ${args.lanClient.pingMs}ms`);
    if (state.gameMode === 'lan_client') {
      const age = args.lanClient.lastSnapshotAt > 0
        ? Math.round(performance.now() - args.lanClient.lastSnapshotAt)
        : -1;
      const seqStr = args.lanLastSnapshotSeq >= 0 ? `seq ${args.lanLastSnapshotSeq}` : 'no snapshot';
      lines.push(`snapshot ${seqStr}  age ${age >= 0 ? age + 'ms' : 'n/a'}`);
      if (age > 3000) lines.push('WARNING: No snapshot for >3s');
      const predErr = args.lanPredictionError ?? 0;
      if (predErr > 0) lines.push(`prediction error ${Math.round(predErr)}px`);
    }
    if (state.gameMode === 'lan_host') {
      lines.push(`snap seq ${args.lanSnapshotSeq}  AI dirs ${args.lanAiDirectorCount}`);
    }
  }

  ctx.save();
  ctx.font = '11px "Poiret One", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const width = 330;
  const height = lines.length * 15 + 12;
  const x = args.screenW - width - 10;
  const y = 10;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.55);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  for (let i = 0; i < lines.length; i++) {
    const isWarning = lines[i].startsWith('WARNING');
    ctx.fillStyle = isWarning
      ? colorToCSS(Colors.alert2, 0.95)
      : colorToCSS(Colors.general_building, 0.9);
    ctx.fillText(lines[i], x + 8, y + 7 + i * 15);
  }
  ctx.restore();
}

export function drawCombatTargetingDebug(ctx: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
  const samples = recentCombatAimSamples(state.gameTime);
  if (samples.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const sample of samples) {
    const age = Math.max(0, state.gameTime - sample.createdAt);
    const alpha = Math.max(0, 1 - age / 2);
    if (alpha <= 0) continue;
    const shooter = camera.worldToScreen(sample.shooter);
    const target = camera.worldToScreen(sample.target);
    const aim = camera.worldToScreen(sample.aimPoint);
    const spawn = camera.worldToScreen(sample.spawn);
    const velEnd = camera.worldToScreen(sample.target.add(sample.targetVelocity.scale(0.35)));

    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.24 * alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(shooter.x, shooter.y, sample.range * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = colorToCSS(Colors.alert1, 0.42 * alpha);
    ctx.beginPath();
    ctx.moveTo(shooter.x, shooter.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    ctx.strokeStyle = sample.interceptValid
      ? colorToCSS(Colors.friendly_status, 0.74 * alpha)
      : colorToCSS(Colors.alert2, 0.64 * alpha);
    ctx.beginPath();
    ctx.moveTo(spawn.x, spawn.y);
    ctx.lineTo(aim.x, aim.y);
    ctx.stroke();

    ctx.fillStyle = colorToCSS(Colors.particles_switch, 0.9 * alpha);
    ctx.beginPath();
    ctx.arc(spawn.x, spawn.y, Math.max(2, 3 * camera.zoom), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = sample.interceptValid
      ? colorToCSS(Colors.friendly_status, 0.95 * alpha)
      : colorToCSS(Colors.alert2, 0.9 * alpha);
    ctx.beginPath();
    ctx.arc(aim.x, aim.y, Math.max(2, 4 * camera.zoom), 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = colorToCSS(Colors.particles_switch, 0.42 * alpha);
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(velEnd.x, velEnd.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawConfluenceTerritory(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: GameState,
  territoryPulseTime: number,
): void {
  const circles = state.territoryCirclesByTeam.get(Team.Player) ?? [];
  for (const c of circles) {
    const sc = camera.worldToScreen(new Vec2(c.x, c.y));
    const rr = c.radius * camera.zoom;
    const grad = ctx.createRadialGradient(sc.x, sc.y, rr * 0.2, sc.x, sc.y, rr);
    grad.addColorStop(0, 'rgba(80,230,220,0.16)');
    grad.addColorStop(1, 'rgba(80,230,220,0.03)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sc.x, sc.y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,255,245,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sc.x, sc.y, rr, 0, Math.PI * 2); ctx.stroke();

    const innerR = rr * 0.78;
    const rotAngle = territoryPulseTime * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -rotAngle * 80;
    ctx.strokeStyle = 'rgba(80,255,240,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sc.x, sc.y, innerR, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const pulsePeriod = 3.2;
    const phaseOffset = (c.x * 0.007 + c.y * 0.013) % pulsePeriod;
    const pulseT = ((territoryPulseTime + phaseOffset) % pulsePeriod) / pulsePeriod;
    if (pulseT < 0.55) {
      const pulseR = rr * (1 + pulseT * 0.28);
      const pulseAlpha = (1 - pulseT / 0.55) * 0.28;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(80,255,240,${pulseAlpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sc.x, sc.y, pulseR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
}
