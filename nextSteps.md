# Confluence follow-up work

- Add full save/load + LAN snapshot serialization for `factionByTeam` and `territoryCirclesByTeam` so matches restore in-progress circle growth exactly.
- Branch enemy/practice AI base planner to intentionally use confluence ring-band placement instead of conduit/planner assumptions.
- Add cached offscreen territory compositing + exterior-boundary-only arc extraction to further reduce overdraw with very high circle counts.
- Add faction selection UI in main/practice setup (currently player faction is initialized to Confluence in start flow).
- Add confluence-specific visual polish for building bases (orbital sockets/motes) and optional deterministic boundary motes.
