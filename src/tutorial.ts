/** Tutorial mode for Gate88 — peaceful learning environment */

import { Colors } from './colors.js';
import { HUD } from './hud.js';
import { GameState } from './gamestate.js';
import { Input } from './input.js';

const TUTORIAL_RESOURCES = 50000;

interface TutorialStep {
  message: string;
  /** Trigger condition — returns true when the step should be shown. */
  trigger: (state: GameState, elapsed: number) => boolean;
  shown: boolean;
  duration?: number;
}

export class TutorialMode {
  private steps: TutorialStep[] = [];
  private startTime: number = 0;

  init(state: GameState, hud: HUD): void {
    state.resources = TUTORIAL_RESOURCES;
    this.startTime = state.gameTime;
    this.steps = createTutorialSteps();

    hud.showMessage('Welcome to Gate 88!', Colors.friendly_status, 5);
    hud.showMessage('This is a peaceful tutorial — no enemies will appear.', Colors.general_building, 6);
  }

  update(state: GameState, hud: HUD, _dt: number): void {
    const elapsed = state.gameTime - this.startTime;

    for (const step of this.steps) {
      if (step.shown) continue;
      if (step.trigger(state, elapsed)) {
        hud.showMessage(step.message, Colors.general_building, step.duration ?? 6);
        step.shown = true;
      }
    }

    // Keep resources topped up in tutorial
    if (state.resources < TUTORIAL_RESOURCES * 0.5) {
      state.resources = TUTORIAL_RESOURCES;
    }
  }
}

function createTutorialSteps(): TutorialStep[] {
  return [
    {
      message: 'Use WASD to move your ship — aim with the mouse, left-click to fire',
      trigger: (_s, elapsed) => elapsed >= 2,
      shown: false,
      duration: 8,
    },
    {
      message: 'Right-click to fire your special ability (homing missile by default)',
      trigger: (_s, elapsed) => elapsed >= 12,
      shown: false,
      duration: 7,
    },
    {
      message: 'Hold E to open the Action Menu — use arrow keys to navigate it',
      trigger: (_s, elapsed) => elapsed >= 22,
      shown: false,
      duration: 7,
    },
    {
      message: 'Try building a Power Generator near your Command Post',
      trigger: (_s, elapsed) => elapsed >= 32,
      shown: false,
      duration: 7,
    },
    {
      message: 'Navigate to a location, then press Enter to place a building',
      trigger: (s, _elapsed) => Input.isDown('e') || Input.isDown('E'),
      shown: false,
      duration: 6,
    },
    {
      message: 'Build a Factory to generate resources over time',
      trigger: (_s, elapsed) => elapsed >= 50,
      shown: false,
      duration: 6,
    },
    {
      message: 'Build a Shipyard to create fighter squadrons',
      trigger: (_s, elapsed) => elapsed >= 65,
      shown: false,
      duration: 6,
    },
    {
      message: 'Use Ship Orders in the Action Menu to command your fighters',
      trigger: (s, _elapsed) => s.fighters.length > 0,
      shown: false,
      duration: 7,
    },
    {
      message: 'Hold Tab to view the full radar overlay',
      trigger: (_s, elapsed) => elapsed >= 80,
      shown: false,
      duration: 6,
    },
    {
      message: 'Build a Research Lab, then use Research in the Action Menu',
      trigger: (_s, elapsed) => elapsed >= 100,
      shown: false,
      duration: 7,
    },
    {
      message: 'Press Escape to pause the game at any time',
      trigger: (_s, elapsed) => elapsed >= 120,
      shown: false,
      duration: 6,
    },
    {
      message: 'You\'re ready! Try Practice mode from the main menu for a real challenge.',
      trigger: (_s, elapsed) => elapsed >= 150,
      shown: false,
      duration: 8,
    },
  ];
}
