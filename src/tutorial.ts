/** Tutorial mode for Sign99 — peaceful learning environment */

import { Colors } from './colors.js';
import { HUD } from './hud.js';
import { GameState } from './gamestate.js';
import { t } from './i18n.js';

const TUTORIAL_RESOURCES = 50000;

interface TutorialStep {
  /** i18n key resolved via {@link t} when the step is shown. */
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

    hud.showMessage(t('tutorial.welcome'), Colors.friendly_status, 5);
    hud.showMessage(t('tutorial.peaceful'), Colors.general_building, 6);
  }

  update(state: GameState, hud: HUD, _dt: number): void {
    const elapsed = state.gameTime - this.startTime;

    for (const step of this.steps) {
      if (step.shown) continue;
      if (step.trigger(state, elapsed)) {
        hud.showMessage(t(step.message), Colors.general_building, step.duration ?? 6);
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
    { message: 'tutorial.step.move', trigger: (_s, elapsed) => elapsed >= 2, shown: false, duration: 8 },
    { message: 'tutorial.step.special', trigger: (_s, elapsed) => elapsed >= 12, shown: false, duration: 7 },
    { message: 'tutorial.step.conduits', trigger: (_s, elapsed) => elapsed >= 16, shown: false, duration: 8 },
    { message: 'tutorial.step.buildMenu', trigger: (_s, elapsed) => elapsed >= 22, shown: false, duration: 8 },
    { message: 'tutorial.step.power', trigger: (_s, elapsed) => elapsed >= 32, shown: false, duration: 7 },
    { message: 'tutorial.step.selectedBuilding', trigger: (_s, elapsed) => elapsed >= 42, shown: false, duration: 7 },
    { message: 'tutorial.step.factory', trigger: (_s, elapsed) => elapsed >= 52, shown: false, duration: 6 },
    { message: 'tutorial.step.shipyard', trigger: (_s, elapsed) => elapsed >= 65, shown: false, duration: 6 },
    { message: 'tutorial.step.groups', trigger: (s, _elapsed) => s.fighters.length > 0, shown: false, duration: 7 },
    { message: 'tutorial.step.radar', trigger: (_s, elapsed) => elapsed >= 80, shown: false, duration: 6 },
    { message: 'tutorial.step.research', trigger: (_s, elapsed) => elapsed >= 100, shown: false, duration: 7 },
    { message: 'tutorial.step.pause', trigger: (_s, elapsed) => elapsed >= 120, shown: false, duration: 6 },
    { message: 'tutorial.step.ready', trigger: (_s, elapsed) => elapsed >= 150, shown: false, duration: 8 },
  ];
}

