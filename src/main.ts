/** Entry point for Gate88 */

import { Game } from './game.js';
import { loadGameFonts } from './fonts.js';
import { applyThemeColors } from './theme.js';
import { installTextOutline } from './textoutline.js';

document.addEventListener('DOMContentLoaded', async () => {
  applyThemeColors();
  await loadGameFonts();
  installTextOutline();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #game not found');
  }
  const game = new Game(canvas);
  game.start();
});

