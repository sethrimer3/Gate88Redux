# Confluence follow-up work

- Add full save/load + LAN snapshot serialization for `factionByTeam` and `territoryCirclesByTeam` so matches restore in-progress circle growth exactly.
- Branch enemy/practice AI base planner to intentionally use confluence ring-band placement instead of conduit/planner assumptions.
- Add cached offscreen territory compositing + exterior-boundary-only arc extraction to further reduce overdraw with very high circle counts.
- Add faction selection UI in main/practice setup (currently player faction is initialized to Confluence in start flow).
- Add confluence-specific visual polish for building bases (orbital sockets/motes) and optional deterministic boundary motes.

# Synonymous ship notes

- The Synonymous player ship now uses a 50-slot deterministic circle renderer in `src/synonymousShipRenderer.ts`; full health shows 40 particles, or 50 after `synonymousVitality`, and damaged health scales down to 20 visible particles.
- Current Synonymous balance values are in `src/constants.ts`: basic laser damage 11, cooldown 56 ticks, range 760, pierce 4. `synonymousPierce` doubles pierce to 8. `synonymousFireSpeed1..4` add +25% base fire-rate per level by dividing the base cooldown by `1 + 0.25 * level`.
- `synonymousSpeed` currently applies `maxSpeed * 1.16` and `thrustPower * 1.18`; `synonymousVitality` applies `maxHealth * 1.4`, heals to full, unlocks 50 full-health particles, and adds 2.2 HP/s regeneration.
- Manual visual QA still needs an in-browser pass for the morph states: idle pentagon, Q/build circle, movement triangle, firing aperture, and damaged particle-count reduction.

# Synonymous mine layer notes

- `synonymousminelayer` is a Synonymous-only offensive turret that costs 65 nanobots, builds in 210 ticks, and maintains up to 9 drifting mines. Each mine drifts toward a 250 world-unit radius, explodes at that radius, and accelerates toward enemies inside 78 world units.
- Mine balance lives in `src/synonymousMine.ts`: 32 damage, 58 AOE radius, 6 mine HP, 23 initial drift speed, and 175 max chase speed. Mine AOE excludes same-team targets through the existing blast-damage team filter.
- Manual visual QA should confirm the 20-nanobot spinning circle reads clearly and that both friendly and hostile projectiles can detonate mines.
