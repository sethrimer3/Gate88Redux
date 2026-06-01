export type CinematicLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

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
    if (raw === 0 || raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5 || raw === 6) {
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
  if (level <= 0) return 0;
  if (level >= 6) return 6;
  if (level >= 5) return 5;
  if (level >= 4) return 4;
  if (level >= 3) return 3;
  if (level >= 2) return 2;
  return 1;
}
