export type CinematicLevel = 0 | 1 | 2;

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
    if (raw === 0 || raw === 1 || raw === 2) {
      cinematicLevel = raw;
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
  if (level <= 0) return 0;
  if (level >= 2) return 2;
  return 1;
}
