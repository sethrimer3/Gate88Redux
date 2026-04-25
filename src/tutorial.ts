/** Tutorial mode for Gate88 — peaceful learning environment */

import { Colors } from './colors.js';
import { HUD } from './hud.js';
import { GameState } from './gamestate.js';

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
      message: 'Hold Q to paint conduits — LMB paints, RMB erases. Conduits zap enemy ships.',
      trigger: (_s, elapsed) => elapsed >= 16,
      shown: false,
      duration: 8,
    },
    {
      message: 'Hold Z to open the Build menu — aim with the mouse, left-click to select',
      trigger: (_s, elapsed) => elapsed >= 22,
      shown: false,
      duration: 8,
    },
    {
      message: 'Try building a Power Generator — it appears near your ship',
      trigger: (_s, elapsed) => elapsed >= 32,
      shown: false,
      duration: 7,
    },
    {
      message: 'Your selected building is shown bottom-left — hold Z and pick another any time',
      trigger: (_s, elapsed) => elapsed >= 42,
      shown: false,
      duration: 7,
    },
    {
      message: 'Build a Factory to generate resources over time',
      trigger: (_s, elapsed) => elapsed >= 52,
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
      message: 'Hold C to open the Command menu — issue orders to Red, Green, or Blue group',
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
      message: 'Build a Research Lab, then hold X to open the Research menu',
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
