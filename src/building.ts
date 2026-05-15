/** Building types for Gate88 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, ShipGroup, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import {
  ENTITY_RADIUS,
  COMMANDPOST_BUILD_RADIUS,
  POWERGENERATOR_COVERAGE_RADIUS,
  HP_VALUES,
} from './constants.js';
import { GRID_CELL_SIZE } from './grid.js';
import { footprintForBuildingType } from './buildingfootprint.js';
import { teamColor } from './teamutils.js';

interface BaseVisual {
  side: number;
  half: number;
  simple: boolean;
  powerAlpha: number;
}

export abstract class BuildingBase extends Entity {
  powered = false;
  buildProgress = 1;
  buildDurationSeconds = 0;
  deletionProgress = 0;
  deletionDurationSeconds = 3;
  deleting = false;
  synonymousVisualKind: 'base' | 'factory' | 'researchlab' | 'laserturret' | 'minelayer' | 'shipyard' | null = null;
  animationTime = 0;
  /**
   * Set to `true` by `update()` the moment `buildProgress` first reaches 1.
   * Cleared externally (e.g. by game.ts) after the completion effect is emitted
   * so the effect fires exactly once per construction event.
   */
  completionEffectPending = false;

  constructor(type: EntityType, team: Team, position: Vec2, health: number, radius: number = ENTITY_RADIUS.building) {
    super(type, team, position, health, radius);
    this.velocity.set(0, 0);
  }
  update(dt: number): void {
    if (!this.alive) return;
    this.animationTime += dt;
    if (this.buildProgress < 1) {
      this.buildProgress = this.buildDurationSeconds <= 0 ? 1 : Math.min(1, this.buildProgress + dt / this.buildDurationSeconds);
      if (this.buildProgress >= 1) {
        this.completionEffectPending = true;
      }
    }
    if (this.deleting) this.deletionProgress = Math.min(1, this.deletionProgress + dt / this.deletionDurationSeconds);
  }
  startDeleting(): void { if (!this.deleting) { this.deleting = true; this.deletionProgress = 0; } }

  protected getBaseVisual(camera: Camera): BaseVisual {
    const side = footprintForBuildingType(this.type) * GRID_CELL_SIZE * camera.zoom;
    return { side, half: side * 0.5, simple: side < 22, powerAlpha: this.powered ? 1 : 0.3 };
  }

  protected drawBuildingBase(ctx: CanvasRenderingContext2D, screen: Vec2, detailColor: string, camera: Camera): BaseVisual {
    const v = this.getBaseVisual(camera);
    if (this.synonymousVisualKind) {
      this.drawSynonymousBuildingBase(ctx, screen, camera, v);
      return v;
    }
    const x = screen.x - v.half;
    const y = screen.y - v.half;
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, this.buildProgress);
    const damage = 1 - Math.max(0, Math.min(1, this.healthFraction));
    ctx.fillStyle = `rgba(58, 77, 64, ${0.96 - damage * 0.18})`;
    ctx.fillRect(x, y, v.side, v.side);
    this.drawSunEdgeGlare(ctx, x, y, v.side, v.simple);
    if (damage > 0.02) this.drawDamageWear(ctx, x, y, v.side, damage);
    ctx.strokeStyle = colorToCSS(Colors.advanced_building, 0.55);
    ctx.lineWidth = Math.max(1, v.side * 0.02);
    ctx.strokeRect(x + 1, y + 1, v.side - 2, v.side - 2);
    ctx.strokeStyle = colorToCSS(Colors.enemy_background, 0.7);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + v.side * 0.12, y + v.side * 0.12, v.side * 0.76, v.side * 0.76);
    const c = v.side * 0.12;
    ctx.fillStyle = colorToCSS(Colors.menu_background_detail, 0.45);
    ctx.fillRect(x, y, c, c); ctx.fillRect(x + v.side - c, y, c, c); ctx.fillRect(x, y + v.side - c, c, c); ctx.fillRect(x + v.side - c, y + v.side - c, c, c);
    if (!v.simple) {
      ctx.strokeStyle = colorToCSS(Colors.advanced_building, 0.45 * v.powerAlpha);
      ctx.beginPath();
      ctx.moveTo(screen.x, y + v.side * 0.15); ctx.lineTo(screen.x, y + v.side * 0.85);
      ctx.moveTo(x + v.side * 0.15, screen.y); ctx.lineTo(x + v.side * 0.85, screen.y);
      ctx.stroke();
    }
    this.drawSquareHealthFrame(ctx, x, y, v.side);
    this.drawPowerStrip(ctx, x, y, v.side);
    if (this.powered && this.buildProgress >= 1 && !v.simple) this.drawPoweredScanLine(ctx, x, y, v.side);
    if (this.buildProgress < 1) this.drawConstructionOverlay(ctx, x, y, v.side);
    if (this.deleting) this.drawDeletionOverlay(ctx, x, y, v.side);
    ctx.restore();
    return v;
  }

  private drawSunEdgeGlare(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, simple: boolean): void {
    const band = Math.max(2, s * (simple ? 0.18 : 0.14));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const topGrad = ctx.createLinearGradient(x, y, x, y + band);
    topGrad.addColorStop(0, 'rgba(255, 235, 78, 0.46)');
    topGrad.addColorStop(0.28, 'rgba(223, 105, 30, 0.26)');
    topGrad.addColorStop(1, 'rgba(223, 105, 30, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, s, band);

    const rightGrad = ctx.createLinearGradient(x + s, y, x + s - band, y);
    rightGrad.addColorStop(0, 'rgba(255, 239, 92, 0.52)');
    rightGrad.addColorStop(0.32, 'rgba(204, 87, 24, 0.30)');
    rightGrad.addColorStop(1, 'rgba(204, 87, 24, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(x + s - band, y, band, s);

    ctx.strokeStyle = 'rgba(255, 246, 112, 0.78)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 0.5);
    ctx.lineTo(x + s - 0.5, y + 0.5);
    ctx.lineTo(x + s - 0.5, y + s - 1);
    ctx.stroke();
    ctx.restore();
  }

  protected drawDamageWear(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, damage: number): void {
    const cracks = Math.min(9, Math.max(2, Math.ceil(damage * 10)));
    ctx.save();
    ctx.strokeStyle = colorToCSS(Colors.enemy_background, 0.22 + damage * 0.45);
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.beginPath();
    for (let i = 0; i < cracks; i++) {
      const seed = (this.id * 31 + i * 17) % 97;
      const px = x + s * (0.16 + ((seed * 37) % 68) / 100);
      const py = y + s * (0.16 + ((seed * 53) % 68) / 100);
      const len = s * (0.07 + damage * 0.12);
      const a = seed * 0.41;
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      if (damage > 0.45) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a + 1.8) * len * 0.55, py + Math.sin(a + 1.8) * len * 0.55);
      }
    }
    ctx.stroke();
    ctx.fillStyle = colorToCSS(Colors.alert1, damage * 0.18);
    ctx.fillRect(x, y, s, s);
    ctx.restore();
  }

  private drawSynonymousBuildingBase(ctx: CanvasRenderingContext2D, screen: Vec2, camera: Camera, v: BaseVisual): void {
    const sides = this.synonymousVisualKind === 'base' ? 6 : this.synonymousVisualKind === 'factory' ? 8 : this.synonymousVisualKind === 'researchlab' ? 5 : 3;
    const r = v.half * (this.synonymousVisualKind === 'base' ? 1.08 : 0.88);
    const color = teamColor(this.team);
    ctx.save();
    const integrityAlpha = 0.32 + 0.48 * this.healthFraction;
    ctx.globalAlpha = Math.max(0.15, this.buildProgress * integrityAlpha);
    ctx.fillStyle = this.synonymousVisualKind === 'base' ? 'rgba(7,10,12,0.96)' : 'rgba(14,17,18,0.46)';
    ctx.strokeStyle = colorToCSS(color, 0.35 + 0.43 * this.healthFraction);
    ctx.lineWidth = Math.max(1, v.side * 0.025);
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
      const x = screen.x + Math.cos(a) * r;
      const y = screen.y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = colorToCSS(color, 0.42);
    ctx.lineWidth = Math.max(1, v.side * 0.012);
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
      const x = screen.x + Math.cos(a) * r * 0.78;
      const y = screen.y + Math.sin(a) * r * 0.78;
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(x, y);
      const b = a + Math.PI * 2 / sides;
      ctx.moveTo(x, y);
      ctx.lineTo(screen.x + Math.cos(b) * r * 0.58, screen.y + Math.sin(b) * r * 0.58);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    const x = screen.x - v.half;
    const y = screen.y - v.half;
    this.drawSquareHealthFrame(ctx, x, y, v.side);
    if (this.buildProgress < 1) this.drawConstructionOverlay(ctx, x, y, v.side);
    if (this.deleting) this.drawDeletionOverlay(ctx, x, y, v.side);
    ctx.restore();
  }

  private drawSquareHealthFrame(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const p = Math.max(0, Math.min(1, this.healthFraction));
    const per = s * 4;
    const len = per * p;
    ctx.strokeStyle = colorToCSS(Colors.healthbar, 0.9);
    ctx.lineWidth = Math.max(1.5, s * 0.03);
    ctx.beginPath();
    const seg = (from: number, to: number, sx: number, sy: number, ex: number, ey: number) => {
      if (len <= from) return; const t = Math.min(1, (len - from) / (to - from)); ctx.moveTo(sx, sy); ctx.lineTo(sx + (ex - sx) * t, sy + (ey - sy) * t);
    };
    seg(0, s, x, y, x + s, y); seg(s, s * 2, x + s, y, x + s, y + s); seg(s * 2, s * 3, x + s, y + s, x, y + s); seg(s * 3, s * 4, x, y + s, x, y);
    ctx.stroke();
  }
  private drawPowerStrip(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const col = this.powered ? Colors.powergenerator_detail : Colors.alert1;
    const a = this.powered ? 0.85 : 0.35;
    const w = Math.max(2, s * 0.06);
    ctx.fillStyle = colorToCSS(col, a);
    ctx.fillRect(x + s * 0.06, y + s * 0.44, w, s * 0.12);
    ctx.fillRect(x + s * 0.44, y + s * 0.06, s * 0.12, w);
  }
  private drawConstructionOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const t = this.buildProgress; const arm = s * 0.22;
    ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.6); ctx.lineWidth = 1.2; ctx.beginPath();
    ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
    ctx.moveTo(x + s, y + arm); ctx.lineTo(x + s, y); ctx.lineTo(x + s - arm, y);
    ctx.moveTo(x, y + s - arm); ctx.lineTo(x, y + s); ctx.lineTo(x + arm, y + s);
    ctx.moveTo(x + s, y + s - arm); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s - arm, y + s); ctx.stroke();
    const sy = y + s * (1 - t); ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.4); ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + s, sy); ctx.stroke();
  }
  private drawDeletionOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const t = this.deletionProgress;
    ctx.setLineDash([6, 4]); ctx.strokeStyle = colorToCSS(Colors.alert2, 0.85); ctx.strokeRect(x - 2, y - 2, s + 4, s + 4); ctx.setLineDash([]);
    ctx.strokeStyle = colorToCSS(Colors.alert1, 0.9); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * t, y); ctx.stroke();
  }
  /** Subtle vertical scan-line that sweeps through a powered building on a ~4 s cycle. */
  private drawPoweredScanLine(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const CYCLE = 4.0;
    const phase = (this.animationTime % CYCLE) / CYCLE;       // 0 → 1
    const sy = y + s * (1 - phase);                           // sweeps bottom-to-top
    const h = Math.max(2, s * 0.08);
    const a = Math.sin(phase * Math.PI) * 0.09;               // fade in/out at edges
    if (a < 0.005) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(x, sy, x, sy + h);
    grad.addColorStop(0, `rgba(255,255,255,0)`);
    grad.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`);
    grad.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, sy, s, h);
    ctx.restore();
  }
}

export class CommandPost extends BuildingBase {
  readonly buildRadius = COMMANDPOST_BUILD_RADIUS;
  constructor(position: Vec2, team: Team) {
    super(EntityType.CommandPost, team, position, HP_VALUES.commandPost, ENTITY_RADIUS.commandpost);
    this.powered = true;
  }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const screen = camera.worldToScreen(this.position);
    const v = this.drawBuildingBase(ctx, screen, colorToCSS(Colors.general_building), camera);
    if (v.simple) return;
    const x = screen.x - v.half;
    const y = screen.y - v.half;
    const pulse = 0.45 + 0.18 * Math.sin(this.animationTime * 2.4);
    // Cross antenna
    ctx.strokeStyle = colorToCSS(Colors.friendly_status, 0.55 + pulse * 0.25);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(screen.x, y + v.side * 0.18); ctx.lineTo(screen.x, y + v.side * 0.82);
    ctx.moveTo(x + v.side * 0.18, screen.y); ctx.lineTo(x + v.side * 0.82, screen.y);
    ctx.stroke();
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.22);
    ctx.strokeRect(x + v.side * 0.27, y + v.side * 0.27, v.side * 0.46, v.side * 0.46);
    // Rotating radar sweep (arc + fading trail)
    const sweepAngle = this.animationTime * 0.85;
    const sweepR = v.side * 0.28;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    // Fading wedge behind the sweep
    const trailSpan = Math.PI * 0.65;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, sweepR, sweepAngle - trailSpan, sweepAngle);
    ctx.closePath();
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.08 * (0.6 + pulse * 0.4));
    ctx.fill();
    // Leading sweep line
    ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.52 + pulse * 0.28);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(sweepAngle) * sweepR, Math.sin(sweepAngle) * sweepR);
    ctx.stroke();
    ctx.restore();
  }
}

export class PowerGenerator extends BuildingBase {
  readonly coverageRadius = POWERGENERATOR_COVERAGE_RADIUS;
  private pulsePhase = 0;
  constructor(position: Vec2, team: Team) {
    super(EntityType.PowerGenerator, team, position, HP_VALUES.powerGenerator);
    this.powered = true;
  }
  update(dt: number): void { super.update(dt); this.pulsePhase += dt * 3; }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const screen = camera.worldToScreen(this.position);
    const v = this.drawBuildingBase(ctx, screen, colorToCSS(Colors.powergenerator_detail), camera);
    if (v.simple) return;
    const glowColor = Colors.building_glow_power;
    const pulseA = 0.9 + 0.1 * Math.sin(this.pulsePhase);
    const coreR = v.side * 0.16 * pulseA;
    // Circular glowing orb core
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(glowColor, this.powered ? 0.55 * v.powerAlpha : 0.15);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, coreR, 0, Math.PI * 2);
    ctx.fill();
    // Energy spokes — 6 radiating arms
    const spokeCount = 6;
    const spokeLen = v.side * 0.26;
    ctx.strokeStyle = colorToCSS(glowColor, this.powered ? 0.38 * v.powerAlpha : 0.10);
    ctx.lineWidth = Math.max(1, v.side * 0.022);
    ctx.beginPath();
    for (let i = 0; i < spokeCount; i++) {
      const a = this.pulsePhase * 0.4 + (Math.PI * 2 * i) / spokeCount;
      const inner = coreR * 0.9;
      const outer = inner + spokeLen * (0.8 + 0.2 * Math.sin(this.pulsePhase * 1.3 + i));
      ctx.moveTo(screen.x + Math.cos(a) * inner, screen.y + Math.sin(a) * inner);
      ctx.lineTo(screen.x + Math.cos(a) * outer, screen.y + Math.sin(a) * outer);
    }
    ctx.stroke();
    ctx.restore();
    // Outer coverage ring (subtle)
    ctx.strokeStyle = colorToCSS(Colors.powergenerator_coverage, 0.15);
    ctx.lineWidth = 1;
    ctx.strokeRect(screen.x - v.half - 2, screen.y - v.half - 2, v.side + 4, v.side + 4);
  }
}

export class Wall extends BuildingBase { shield=0; maxShield=0; private shieldRegenDelay=0; poweredWallUpgrade=false; constructor(position: Vec2, team: Team){ super(EntityType.Wall, team, position, HP_VALUES.wall); this.powered=true; } enablePoweredWall():void{this.poweredWallUpgrade=true;this.maxShield=20;this.shield=this.maxShield;this.shieldRegenDelay=0;} override update(dt:number):void{super.update(dt); if(this.poweredWallUpgrade&&this.alive){this.shieldRegenDelay=Math.max(0,this.shieldRegenDelay-dt); if(this.shieldRegenDelay<=0&&this.shield<this.maxShield)this.shield=Math.min(this.maxShield,this.shield+5*dt);}} override takeDamage(amount:number,source?:Entity):void{if(amount>0&&this.poweredWallUpgrade&&this.shield>0){this.shieldRegenDelay=5;const absorbed=Math.min(this.shield,amount);this.shield-=absorbed;amount-=absorbed;if(amount<=0)return;}super.takeDamage(amount,source);} draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const v=this.drawBuildingBase(ctx,screen,colorToCSS(Colors.advanced_building),camera); const x=screen.x-v.half,y=screen.y-v.half; const pulse=0.55+0.35*Math.sin(this.animationTime*4); ctx.save(); if(this.poweredWallUpgrade){ctx.globalCompositeOperation='lighter';ctx.strokeStyle=colorToCSS(Colors.radar_friendly_status,0.22+0.28*(this.shield/Math.max(1,this.maxShield)));ctx.lineWidth=Math.max(2,v.side*0.06);ctx.strokeRect(x+2,y+2,v.side-4,v.side-4);} ctx.globalCompositeOperation='source-over'; ctx.strokeStyle=colorToCSS(Colors.powergenerator_detail,0.68+0.22*pulse); ctx.lineWidth=Math.max(2,v.side*0.05); ctx.beginPath(); ctx.moveTo(x+v.side*0.15,y+v.side*0.5); ctx.lineTo(x+v.side*0.85,y+v.side*0.5); ctx.moveTo(x+v.side*0.5,y+v.side*0.15); ctx.lineTo(x+v.side*0.5,y+v.side*0.85); ctx.stroke(); ctx.restore(); }}

export class Shipyard extends BuildingBase { shipCapacity=5; activeShips=0; buildTimer=0; buildInterval=5; assignedGroup: ShipGroup=ShipGroup.Red; holdDocked=false; dockedShips=0; fightersReleased=false; launchFlashTimer=0;
constructor(type:EntityType.FighterYard|EntityType.BomberYard,position:Vec2,team:Team){super(type, team, position, type===EntityType.FighterYard ? HP_VALUES.fighterYard : HP_VALUES.bomberYard);this.powered=false;} update(dt:number):void{super.update(dt);if(this.buildProgress>=1&&this.powered&&this.activeShips<this.shipCapacity)this.buildTimer-=dt;if(this.launchFlashTimer>0)this.launchFlashTimer=Math.max(0,this.launchFlashTimer-dt);} shouldSpawnShip():boolean{if(!this.alive||!this.powered||this.buildProgress<1)return false;if(this.buildTimer<=0&&this.activeShips<this.shipCapacity){this.buildTimer=this.buildInterval;this.launchFlashTimer=0.55;return true;}return false;} bayPosition():Vec2{return this.position.add(new Vec2(0, GRID_CELL_SIZE*1.15));} draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const isF=this.type===EntityType.FighterYard; const detail=isF?Colors.fighteryard_detail:Colors.bomberyard_detail; if(this.synonymousVisualKind==='shipyard'){this.drawSynonymousShipyard(ctx,camera,screen);return;} const v=this.drawBuildingBase(ctx,screen,colorToCSS(detail),camera); const bayW=v.side*0.55,bayH=v.side*0.18; ctx.fillStyle=colorToCSS(Colors.enemy_background,0.8); ctx.fillRect(screen.x-bayW*0.5,screen.y+v.side*0.2,bayW,bayH); for(let i=0;i<Math.min(this.dockedShips,this.shipCapacity);i++){const col=i%3,row=Math.floor(i/3);const sx=screen.x-v.side*0.28+col*v.side*0.28;const sy=screen.y-v.side*0.24+row*v.side*0.2; ctx.strokeStyle=colorToCSS(detail, this.powered?0.9:0.45); ctx.beginPath(); if(isF){ctx.moveTo(sx+4,sy);ctx.lineTo(sx-3,sy-2);ctx.lineTo(sx-3,sy+2);} else {ctx.moveTo(sx+4,sy);ctx.lineTo(sx,sy-3);ctx.lineTo(sx-4,sy);ctx.lineTo(sx,sy+3);} ctx.closePath();ctx.stroke(); }
if(this.launchFlashTimer>0){const f=this.launchFlashTimer/0.55;ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=colorToCSS(detail,f*0.80);ctx.lineWidth=Math.max(1,v.side*0.042);ctx.strokeRect(screen.x-bayW*0.5-1,screen.y+v.side*0.19,bayW+2,bayH+2);ctx.fillStyle=colorToCSS(detail,f*0.22);ctx.fillRect(screen.x-bayW*0.5-1,screen.y+v.side*0.19,bayW+2,bayH+2);ctx.restore();}
if(this.team===Team.Player){ctx.fillStyle=colorToCSS(Colors.alert2,0.9);ctx.font=`bold ${Math.max(10,v.side*0.15)}px "Poiret One", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`${this.assignedGroup+1}`,screen.x+v.side*0.3,screen.y-v.side*0.32);} }
private drawSynonymousShipyard(ctx:CanvasRenderingContext2D,camera:Camera,screen:Vec2):void{const v=this.getBaseVisual(camera);const color=teamColor(this.team);const nodeR=Math.max(2,v.side*0.055);const r=v.side*0.44;ctx.save();ctx.globalAlpha=Math.max(0.18,this.buildProgress);ctx.globalCompositeOperation='lighter';ctx.strokeStyle=colorToCSS(color,this.powered?0.42:0.18);ctx.lineWidth=Math.max(1,v.side*0.016);ctx.beginPath();const nodes:Array<{x:number;y:number}>=[];for(let i=0;i<11;i++){const a=-Math.PI*0.92+i*(Math.PI*1.84/10);const x=screen.x+Math.cos(a)*r;const y=screen.y+Math.sin(a)*r;nodes.push({x,y});if(i>0){ctx.moveTo(nodes[i-1].x,nodes[i-1].y);ctx.lineTo(x,y);}if(i%2===0){ctx.moveTo(screen.x,screen.y-v.side*0.05);ctx.lineTo(x,y);}}ctx.stroke();ctx.strokeStyle=colorToCSS(Colors.particles_switch,this.powered?0.22:0.10);ctx.beginPath();ctx.arc(screen.x,screen.y-v.side*0.02,r*0.62,Math.PI*1.08,Math.PI*1.92);ctx.stroke();ctx.fillStyle='rgba(4,8,10,0.88)';ctx.beginPath();ctx.ellipse(screen.x,screen.y+r*0.72,v.side*0.24,v.side*0.10,0,0,Math.PI*2);ctx.fill();for(const n of nodes){ctx.fillStyle=colorToCSS(color,this.powered?0.82:0.38);ctx.beginPath();ctx.arc(n.x,n.y,nodeR,0,Math.PI*2);ctx.fill();}const shown=Math.min(this.dockedShips,this.shipCapacity);for(let i=0;i<shown;i++){const x=screen.x-v.side*0.23+(i%5)*v.side*0.115;const y=screen.y+v.side*0.24+Math.floor(i/5)*v.side*0.10;ctx.strokeStyle=colorToCSS(color,0.72);ctx.beginPath();ctx.moveTo(x,y-v.side*0.028);ctx.lineTo(x-v.side*0.032,y+v.side*0.028);ctx.lineTo(x+v.side*0.032,y+v.side*0.028);ctx.closePath();ctx.stroke();}if(this.team===Team.Player){ctx.fillStyle=colorToCSS(Colors.alert2,0.9);ctx.font=`bold ${Math.max(10,v.side*0.15)}px "Poiret One", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`${this.assignedGroup+1}`,screen.x+v.side*0.3,screen.y-v.side*0.32);}ctx.restore();}}

export class ResearchLab extends BuildingBase {
  private spinPhase = 0;
  constructor(position: Vec2, team: Team) {
    super(EntityType.ResearchLab, team, position, HP_VALUES.researchLab);
  }
  update(dt: number): void { super.update(dt); this.spinPhase += this.powered ? dt * 2 : dt * 0.35; }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const screen = camera.worldToScreen(this.position);
    const v = this.drawBuildingBase(ctx, screen, colorToCSS(Colors.researchlab_detail), camera);
    if (v.simple) return;
    const glowColor = Colors.building_glow_research;
    const ringA = this.powered ? 0.85 : 0.45;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    // Three spinning elliptical rings
    ctx.strokeStyle = colorToCSS(Colors.researchlab_detail, ringA);
    ctx.lineWidth = Math.max(0.8, v.side * 0.018);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate(this.spinPhase + i * 2.094);
      ctx.scale(1, 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, v.side * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Orbiting node dots — 3 nodes at staggered radii and speeds
    if (this.powered) {
      ctx.globalCompositeOperation = 'lighter';
      const nodeR = Math.max(1.2, v.side * 0.045);
      const orbits: Array<{ radius: number; speed: number; phase: number }> = [
        { radius: v.side * 0.18, speed: 1.0, phase: 0 },
        { radius: v.side * 0.26, speed: -0.65, phase: 2.1 },
        { radius: v.side * 0.22, speed: 0.82, phase: 4.2 },
      ];
      for (const orbit of orbits) {
        const a = this.spinPhase * orbit.speed + orbit.phase;
        const nx = Math.cos(a) * orbit.radius;
        const ny = Math.sin(a) * orbit.radius * 0.55;
        ctx.fillStyle = colorToCSS(glowColor, 0.72);
        ctx.beginPath();
        ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export class Factory extends BuildingBase {
  private gearPhase = 0;
  constructor(position: Vec2, team: Team) {
    super(EntityType.Factory, team, position, HP_VALUES.factory);
  }
  update(dt: number): void { super.update(dt); this.gearPhase += this.powered ? dt * 1.5 : dt * 0.2; }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const screen = camera.worldToScreen(this.position);
    const v = this.drawBuildingBase(ctx, screen, colorToCSS(Colors.factory_detail), camera);
    if (v.simple) return;
    const glowColor = Colors.building_glow_factory;
    const gearA = this.powered ? 0.80 : 0.45;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    // Outer gear (8 teeth)
    ctx.rotate(this.gearPhase);
    ctx.strokeStyle = colorToCSS(Colors.factory_detail, gearA);
    ctx.lineWidth = Math.max(1, v.side * 0.025);
    const t = 8;
    const inner = v.side * 0.12;
    const outer = v.side * 0.21;
    ctx.beginPath();
    for (let i = 0; i < t; i++) {
      const a = (Math.PI * 2 * i) / t;
      ctx.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a + 0.2) * outer, Math.sin(a + 0.2) * outer);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Inner counter-rotating ring with 4 spokes
    if (!v.simple) {
      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(-this.gearPhase * 1.5);
      ctx.strokeStyle = colorToCSS(glowColor, this.powered ? 0.45 : 0.18);
      ctx.lineWidth = Math.max(0.8, v.side * 0.016);
      ctx.beginPath();
      ctx.arc(0, 0, v.side * 0.08, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI * 2 * i) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * v.side * 0.085, Math.sin(a) * v.side * 0.085);
        ctx.lineTo(Math.cos(a) * v.side * 0.14, Math.sin(a) * v.side * 0.14);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
