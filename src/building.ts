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

  constructor(type: EntityType, team: Team, position: Vec2, health: number, radius: number = ENTITY_RADIUS.building) {
    super(type, team, position, health, radius);
    this.velocity.set(0, 0);
  }
  update(dt: number): void { if (!this.alive) return; if (this.buildProgress < 1) this.buildProgress = this.buildDurationSeconds <= 0 ? 1 : Math.min(1, this.buildProgress + dt / this.buildDurationSeconds); if (this.deleting) this.deletionProgress = Math.min(1, this.deletionProgress + dt / this.deletionDurationSeconds); }
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
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.95);
    ctx.fillRect(x, y, v.side, v.side);
    ctx.strokeStyle = colorToCSS(Colors.advanced_building, 0.8);
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
    if (this.buildProgress < 1) this.drawConstructionOverlay(ctx, x, y, v.side);
    if (this.deleting) this.drawDeletionOverlay(ctx, x, y, v.side);
    ctx.restore();
    return v;
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
}

export class CommandPost extends BuildingBase { readonly buildRadius = COMMANDPOST_BUILD_RADIUS; constructor(position: Vec2, team: Team) { super(EntityType.CommandPost, team, position, HP_VALUES.commandPost, ENTITY_RADIUS.commandpost); this.powered = true; }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void { const screen = camera.worldToScreen(this.position); const v = this.drawBuildingBase(ctx, screen, colorToCSS(Colors.general_building), camera); const x=screen.x-v.half,y=screen.y-v.half; ctx.strokeStyle=colorToCSS(Colors.friendly_status,0.55); ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(screen.x,y+v.side*0.18);ctx.lineTo(screen.x,y+v.side*0.82);ctx.moveTo(x+v.side*0.18,screen.y);ctx.lineTo(x+v.side*0.82,screen.y); ctx.stroke(); }}

export class PowerGenerator extends BuildingBase { readonly coverageRadius = POWERGENERATOR_COVERAGE_RADIUS; private pulsePhase=0; constructor(position: Vec2, team: Team){ super(EntityType.PowerGenerator,team,position,HP_VALUES.powerGenerator); this.powered=true;} update(dt:number):void{super.update(dt);this.pulsePhase+=dt*3;} draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const v=this.drawBuildingBase(ctx,screen,colorToCSS(Colors.powergenerator_detail),camera); const core=v.side*0.24*(0.9+0.1*Math.sin(this.pulsePhase)); ctx.fillStyle=colorToCSS(Colors.powergenerator_detail,0.65); ctx.fillRect(screen.x-core,screen.y-core,core*2,core*2); ctx.strokeStyle=colorToCSS(Colors.powergenerator_coverage,0.2); ctx.strokeRect(screen.x-v.half-2,screen.y-v.half-2,v.side+4,v.side+4); }}

export class Wall extends BuildingBase { constructor(position: Vec2, team: Team){ super(EntityType.Wall, team, position, HP_VALUES.wall); } draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const v=this.drawBuildingBase(ctx,screen,colorToCSS(Colors.advanced_building),camera); const x=screen.x-v.half,y=screen.y-v.half; ctx.save(); ctx.strokeStyle=colorToCSS(Colors.powergenerator_detail,this.powered?0.55:0.28); ctx.lineWidth=Math.max(1,v.side*0.035); ctx.beginPath(); ctx.moveTo(x+v.side*0.18,y+v.side*0.5); ctx.lineTo(x+v.side*0.82,y+v.side*0.5); ctx.moveTo(x+v.side*0.5,y+v.side*0.18); ctx.lineTo(x+v.side*0.5,y+v.side*0.82); ctx.stroke(); ctx.restore(); }}

export class Shipyard extends BuildingBase { shipCapacity=5; activeShips=0; buildTimer=0; buildInterval=5; assignedGroup: ShipGroup=ShipGroup.Red; holdDocked=false; dockedShips=0; fightersReleased=false;
constructor(type:EntityType.FighterYard|EntityType.BomberYard,position:Vec2,team:Team){super(type, team, position, type===EntityType.FighterYard ? HP_VALUES.fighterYard : HP_VALUES.bomberYard);this.powered=false;} update(dt:number):void{super.update(dt);if(this.buildProgress>=1&&this.powered&&this.activeShips<this.shipCapacity)this.buildTimer-=dt;} shouldSpawnShip():boolean{if(!this.alive||!this.powered||this.buildProgress<1)return false;if(this.buildTimer<=0&&this.activeShips<this.shipCapacity){this.buildTimer=this.buildInterval;return true;}return false;} bayPosition():Vec2{return this.position.add(new Vec2(0, GRID_CELL_SIZE*1.15));} draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const isF=this.type===EntityType.FighterYard; const detail=isF?Colors.fighteryard_detail:Colors.bomberyard_detail; if(this.synonymousVisualKind==='shipyard'){this.drawSynonymousShipyard(ctx,camera,screen);return;} const v=this.drawBuildingBase(ctx,screen,colorToCSS(detail),camera); const bayW=v.side*0.55,bayH=v.side*0.18; ctx.fillStyle=colorToCSS(Colors.enemy_background,0.8); ctx.fillRect(screen.x-bayW*0.5,screen.y+v.side*0.2,bayW,bayH); for(let i=0;i<Math.min(this.dockedShips,this.shipCapacity);i++){const col=i%3,row=Math.floor(i/3);const sx=screen.x-v.side*0.28+col*v.side*0.28;const sy=screen.y-v.side*0.24+row*v.side*0.2; ctx.strokeStyle=colorToCSS(detail, this.powered?0.9:0.45); ctx.beginPath(); if(isF){ctx.moveTo(sx+4,sy);ctx.lineTo(sx-3,sy-2);ctx.lineTo(sx-3,sy+2);} else {ctx.moveTo(sx+4,sy);ctx.lineTo(sx,sy-3);ctx.lineTo(sx-4,sy);ctx.lineTo(sx,sy+3);} ctx.closePath();ctx.stroke(); }
if(this.team===Team.Player){ctx.fillStyle=colorToCSS(Colors.alert2,0.9);ctx.font=`bold ${Math.max(10,v.side*0.15)}px "Poiret One", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`${this.assignedGroup+1}`,screen.x+v.side*0.3,screen.y-v.side*0.32);} }
private drawSynonymousShipyard(ctx:CanvasRenderingContext2D,camera:Camera,screen:Vec2):void{const v=this.getBaseVisual(camera);const color=teamColor(this.team);const nodeR=Math.max(2,v.side*0.055);const r=v.side*0.44;ctx.save();ctx.globalAlpha=Math.max(0.18,this.buildProgress);ctx.globalCompositeOperation='lighter';ctx.strokeStyle=colorToCSS(color,this.powered?0.42:0.18);ctx.lineWidth=Math.max(1,v.side*0.016);ctx.beginPath();const nodes:Array<{x:number;y:number}>=[];for(let i=0;i<11;i++){const a=-Math.PI*0.92+i*(Math.PI*1.84/10);const x=screen.x+Math.cos(a)*r;const y=screen.y+Math.sin(a)*r;nodes.push({x,y});if(i>0){ctx.moveTo(nodes[i-1].x,nodes[i-1].y);ctx.lineTo(x,y);}if(i%2===0){ctx.moveTo(screen.x,screen.y-v.side*0.05);ctx.lineTo(x,y);}}ctx.stroke();ctx.strokeStyle=colorToCSS(Colors.particles_switch,this.powered?0.22:0.10);ctx.beginPath();ctx.arc(screen.x,screen.y-v.side*0.02,r*0.62,Math.PI*1.08,Math.PI*1.92);ctx.stroke();ctx.fillStyle='rgba(4,8,10,0.88)';ctx.beginPath();ctx.ellipse(screen.x,screen.y+r*0.72,v.side*0.24,v.side*0.10,0,0,Math.PI*2);ctx.fill();for(const n of nodes){ctx.fillStyle=colorToCSS(color,this.powered?0.82:0.38);ctx.beginPath();ctx.arc(n.x,n.y,nodeR,0,Math.PI*2);ctx.fill();}const shown=Math.min(this.dockedShips,this.shipCapacity);for(let i=0;i<shown;i++){const x=screen.x-v.side*0.23+(i%5)*v.side*0.115;const y=screen.y+v.side*0.24+Math.floor(i/5)*v.side*0.10;ctx.strokeStyle=colorToCSS(color,0.72);ctx.beginPath();ctx.moveTo(x,y-v.side*0.028);ctx.lineTo(x-v.side*0.032,y+v.side*0.028);ctx.lineTo(x+v.side*0.032,y+v.side*0.028);ctx.closePath();ctx.stroke();}if(this.team===Team.Player){ctx.fillStyle=colorToCSS(Colors.alert2,0.9);ctx.font=`bold ${Math.max(10,v.side*0.15)}px "Poiret One", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`${this.assignedGroup+1}`,screen.x+v.side*0.3,screen.y-v.side*0.32);}ctx.restore();}}

export class ResearchLab extends BuildingBase { private spinPhase=0; constructor(position:Vec2,team:Team){super(EntityType.ResearchLab,team,position,HP_VALUES.researchLab);} update(dt:number):void{super.update(dt);this.spinPhase+=this.powered?dt*2:dt*0.35;} draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const v=this.drawBuildingBase(ctx,screen,colorToCSS(Colors.researchlab_detail),camera); ctx.save(); ctx.translate(screen.x,screen.y); ctx.strokeStyle=colorToCSS(Colors.researchlab_detail,this.powered?0.85:0.45); for(let i=0;i<3;i++){ctx.save();ctx.rotate(this.spinPhase+i*2.094);ctx.scale(1,0.45);ctx.beginPath();ctx.arc(0,0,v.side*0.22,0,Math.PI*2);ctx.stroke();ctx.restore();}ctx.restore(); }}

export class Factory extends BuildingBase { private gearPhase=0; constructor(position:Vec2,team:Team){super(EntityType.Factory,team,position,HP_VALUES.factory);} update(dt:number):void{super.update(dt);this.gearPhase+=this.powered?dt*1.5:dt*0.2;} draw(ctx:CanvasRenderingContext2D,camera:Camera):void{ const screen=camera.worldToScreen(this.position); const v=this.drawBuildingBase(ctx,screen,colorToCSS(Colors.factory_detail),camera); ctx.save(); ctx.translate(screen.x,screen.y); ctx.rotate(this.gearPhase); ctx.strokeStyle=colorToCSS(Colors.factory_detail,this.powered?0.8:0.45); const t=8,inner=v.side*0.12,outer=v.side*0.21; ctx.beginPath(); for(let i=0;i<t;i++){const a=(Math.PI*2*i)/t;ctx.lineTo(Math.cos(a)*inner,Math.sin(a)*inner);ctx.lineTo(Math.cos(a+0.2)*outer,Math.sin(a+0.2)*outer);} ctx.closePath(); ctx.stroke(); ctx.restore(); }}
