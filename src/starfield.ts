/** Background starfield rendering for Gate88 */

import { Vec2, randomRange } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS, Color } from './colors.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
  /** Depth layer 0–1 where 0 is far (slow parallax) and 1 is near. */
  depth: number;
}

const STAR_COUNT = 400;
const MAP_CENTER_X = WORLD_WIDTH * 0.5;

export class Starfield {
  private stars: Star[] = [];

  constructor() {
    this.generate();
  }

  private generate(): void {
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: randomRange(-WORLD_WIDTH * 0.5, WORLD_WIDTH * 1.5),
        y: randomRange(-WORLD_HEIGHT * 0.5, WORLD_HEIGHT * 1.5),
        brightness: randomRange(0.2, 1.0),
        size: randomRange(0.5, 2.0),
        depth: randomRange(0.1, 1.0),
      });
    }
  }

  /** Choose star color based on which half of the map the star occupies. */
  private starColor(star: Star): Color {
    return star.x < MAP_CENTER_X
      ? Colors.friendly_starfield
      : Colors.enemy_starfield;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, screenW: number, screenH: number): void {
    for (const star of this.stars) {
      // Parallax: deeper stars move slower relative to camera
      const parallax = 0.3 + star.depth * 0.7;
      const sx =
        (star.x - camera.position.x * parallax) * camera.zoom +
        screenW * 0.5;
      const sy =
        (star.y - camera.position.y * parallax) * camera.zoom +
        screenH * 0.5;

      // Cull off-screen stars
      if (sx < -4 || sx > screenW + 4 || sy < -4 || sy > screenH + 4) {
        continue;
      }

      const color = this.starColor(star);
      const alpha = star.brightness * (0.5 + star.depth * 0.5);
      const r = star.size * camera.zoom * (0.5 + star.depth * 0.5);

      ctx.fillStyle = colorToCSS(color, alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
