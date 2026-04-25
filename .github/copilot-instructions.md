# Gate 88 — Agent / Contributor Instructions

These notes apply to anyone (humans or AI agents) making changes to this
repository. They are intentionally short. Read them before you start.

## Build number bumps

The main menu shows a build number in the top-right corner. The single
source of truth is `src/version.ts` (`BUILD_NUMBER`).

**Rules:**

1. **Bump `BUILD_NUMBER` by exactly 1 per completed feature branch /
   pull request** that delivers a meaningful implementation change.
2. Trivial commits *inside* a branch (typo fixes, comment tweaks,
   re-runs of a formatter, etc.) should **not** bump the build number.
   The bump happens once, at the end of the branch.
3. If the project ever stops using PRs, bump once per completed
   implementation commit instead.
4. **Never auto-increment at runtime.** This is a deliberate
   source-controlled version bump.
5. Pure documentation-only PRs do not need to bump the build number.

When in doubt: one PR → one bump.

## Architectural conventions worth preserving

* Fixed 60 Hz update loop. Don't run expensive AI planning every tick;
  cache strategic evaluations and refresh them on intervals or
  topology-change events.
* Configuration objects (`PracticeConfig`, `VsAIConfig`, build defs in
  `src/builddefs.ts`) are the central place for tuning values. Don't
  scatter difficulty constants through gameplay code.
* `PracticeMode` and `VsAIMode` are deliberately separate. Practice is
  a growing-base survival opponent. Vs. AI is an opposing player-like
  bot with its own main ship.
* All new menus and submenus must be operable with the mouse alone.
  Keyboard shortcuts may also exist, but the mouse path must work.
