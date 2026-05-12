/**
 * Central build / version metadata for Gate 88.
 *
 * Bump `BUILD_NUMBER` once per completed feature branch / PR. Trivial
 * fix-up commits inside a branch should *not* bump the build number.
 *
 * The main menu reads `buildLabel()` and renders it in the top-right
 * corner. Do not add runtime auto-incrementing — this is a deliberate
 * source-controlled version bump (see `.github/copilot-instructions.md`).
 */

/** Monotonic implementation-build counter. Increment by 1 per merged PR. */
export const BUILD_NUMBER = 31;

/** Human-readable build label, e.g. "Build 008". */
export function buildLabel(): string {
  return `Build ${String(BUILD_NUMBER).padStart(3, '0')}`;
}

