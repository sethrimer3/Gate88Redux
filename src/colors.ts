/** Color definitions parsed from the original Gate88 colours.conf and textcolours.conf */

export interface Color {
  r: number;
  g: number;
  b: number;
  intensity: number;
}

/** Convert a Color to a CSS rgba string, applying intensity as a multiplier and clamping to 255. */
export function colorToCSS(color: Color, alpha: number = 1.0): string {
  const r = Math.min(255, Math.round(color.r * color.intensity));
  const g = Math.min(255, Math.round(color.g * color.intensity));
  const b = Math.min(255, Math.round(color.b * color.intensity));
  return `rgba(${r},${g},${b},${alpha})`;
}

function c(r: number, g: number, b: number, intensity: number): Color {
  return { r, g, b, intensity };
}

export const Colors = {
  menu_background:            c(0, 50, 130, 1.0),
  menu_background_detail:     c(107, 0, 1, 1.0),
  friendly_background:        c(2, 18, 28, 1.0),
  enemy_background:           c(25, 15, 8, 1.0),
  friendly_starfield:         c(11, 80, 124, 0.65),
  enemy_starfield:            c(121, 57, 57, 0.63),
  general_building:           c(174, 198, 175, 1.0),
  advanced_building:          c(174, 198, 175, 1.0),
  shipyard:                   c(205, 190, 163, 1.0),
  fighters:                   c(168, 193, 207, 1.0),
  mainguy:                    c(205, 190, 163, 1.24),
  enemy_status:               c(107, 0, 1, 1.0),
  friendly_status:            c(0, 53, 0, 1.3),
  allied_status:              c(0, 50, 130, 1.0),
  explosion:                  c(103, 59, 54, 2.0),
  friendly_explosion:         c(89, 0, 38, 1.0),
  factory_detail:             c(107, 70, 0, 1.8),
  researchlab_detail:         c(40, 86, 47, 2.0),
  powergenerator_detail:      c(70, 81, 30, 3.1),
  powergenerator_coverage:    c(11, 80, 124, 1.0),
  timebomb_detail:            c(111, 65, 37, 2.0),
  missileturret_detail:       c(163, 193, 205, 1.2),
  gatlingturret_detail:       c(190, 210, 120, 1.4),
  exciterturret_detail:       c(65, 35, 0, 3.9),
  massdriverturret_detail:    c(60, 40, 18, 2.0),
  regenturret_detail:         c(174, 198, 175, 1.0),
  signalstation_detail:       c(173, 219, 197, 1.0),
  jumpgate_detail:            c(0, 50, 130, 1.0),
  fighteryard_detail:         c(205, 190, 163, 1.0),
  bomberyard_detail:          c(205, 190, 163, 1.0),
  fighter_detail:             c(70, 81, 30, 1.0),
  bomber_detail:              c(65, 35, 0, 1.0),
  aifighter_detail:           c(111, 65, 37, 1.0),
  aibomber_detail:            c(107, 0, 1, 1.0),
  airepairdood_detail:        c(107, 0, 1, 1.0),
  aibigfireturret_detail:     c(107, 0, 1, 1.0),
  aispreadfireturret_detail:  c(107, 0, 1, 1.0),
  redgroup:                   c(228, 0, 33, 1.0),
  greengroup:                 c(0, 176, 66, 1.0),
  bluegroup:                  c(0, 33, 176, 1.0),
  friendlyfire:               c(0, 176, 66, 1.0),
  enemyfire:                  c(228, 0, 33, 1.0),
  alliedfire:                 c(0, 66, 176, 1.0),
  cloak:                      c(205, 190, 163, 1.24),
  radar_tint:                         c(40, 86, 47, 0.3),
  radar_gridlines:                    c(40, 86, 47, 1.0),
  radar_signalstation_coverage:       c(40, 86, 47, 1.0),
  radar_enemy_status:                 c(107, 0, 1, 1.8),
  radar_friendly_status:              c(0, 234, 0, 1.0),
  radar_allied_status:                c(0, 50, 130, 1.8),
  particles_friendly_exhaust:   c(56, 132, 68, 1.0),
  particles_enemy_exhaust:      c(132, 56, 68, 1.0),
  particles_allied_exhaust:     c(56, 68, 132, 1.0),
  particles_neutral_exhaust:    c(255, 246, 230, 0.67),
  particles_switch:             c(255, 246, 230, 1.0),
  particles_healing:            c(174, 198, 175, 1.0),
  particles_explosion1:         c(107, 0, 1, 2.0),
  particles_explosion2:         c(130, 110, 0, 1.0),
  particles_explosion3:         c(255, 255, 255, 1.0),
  particles_spark:              c(0, 210, 255, 1.0),
  particles_ember:              c(255, 140, 20, 1.0),
  particles_nova:               c(255, 240, 180, 1.0),
  healthbar:                    c(0, 53, 0, 4.0),
  batterybar:                   c(107, 0, 1, 2.0),
  alert1:                       c(255, 0, 0, 1.0),
  alert2:                       c(255, 255, 0, 1.0),
} as const;

export const TextColors = {
  normal:     c(174, 198, 175, 1.0),
  highlight:  c(174, 198, 175, 1.287),
  shadow:     c(173, 193, 219, 0.33),
  title:      c(173, 193, 219, 1.287),
  titledark:  c(173, 193, 219, 0.33),
  enemy:      c(222, 182, 180, 1.0),
  ally:       c(173, 193, 219, 1.0),
  private:    c(205, 190, 163, 1.0),
  admin:      c(174, 198, 175, 1.0),
  system:     c(224, 255, 226, 1.0),
} as const;

