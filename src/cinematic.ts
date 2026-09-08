export type CinematicLevel = -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const CINEMATIC_LEVEL_STORAGE_KEY = 'gate88_cinematic_level';

let cinematicLevel: CinematicLevel = 1;

export function getCinematicLevel(): CinematicLevel {
  return cinematicLevel;
}

export function setCinematicLevel(level: number): CinematicLevel {
  cinematicLevel = clampCinematicLevel(level);
  return cinematicLevel;
}

export function loadCinematicLevel(): CinematicLevel {
  try {
    const raw = Number(window.localStorage?.getItem(CINEMATIC_LEVEL_STORAGE_KEY));
    if (Number.isInteger(raw) && raw >= -3 && raw <= 9) {
      cinematicLevel = raw as CinematicLevel;
      return cinematicLevel;
    }
  } catch {
    // localStorage unavailable; keep the default.
  }
  cinematicLevel = 1;
  return cinematicLevel;
}

export function saveCinematicLevel(level: CinematicLevel): void {
  cinematicLevel = level;
  try {
    window.localStorage?.setItem(CINEMATIC_LEVEL_STORAGE_KEY, String(level));
  } catch {
    // Ignore write failures.
  }
}

export function clampCinematicLevel(level: number): CinematicLevel {
  return Math.max(-3, Math.min(9, Math.round(level))) as CinematicLevel;
}
