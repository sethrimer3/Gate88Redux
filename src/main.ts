/** Entry point for Gate88 */

import { Game } from './game.js';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #game not found');
  }
  const game = new Game(canvas);
  game.start();
});
