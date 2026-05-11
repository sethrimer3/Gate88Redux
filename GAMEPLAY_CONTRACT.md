# Gameplay Contract

This build targets a small playable Gate 88 loop: direct ship control, grid-snapped base construction, conduits, research unlocks, shipyards, turrets, and command post destruction.

## Races

- Terran is the original conduit faction. It uses the Q conduit brush, conduit-graph power, and automatic conduit blueprints around placed buildings.
- Concentroid is the circle-territory faction. It does not use conduits; buildings extend territory circles and must be placed on the Concentroid frontier band.
- The Synonymous is the nanobot-swarm faction. It does not use conduits or grid power; the Command Post and Factories produce nanobot drones, Q exposes a free Shape tool, and the first playable structures are Factory, Research Lab, and a weak fast Laser Turret represented through the Missile Turret slot.
- Practice, Vs. AI, and LAN setup expose race selection. Random resolves to Terran, Concentroid, or The Synonymous when the match starts.

## Controls

- WASD moves the player ship. Mouse aims. Left mouse fires the primary weapon.
- Right mouse fires the equipped special; the only exposed special is Homing Missile.
- Hold Q for the build menu, choose a building from the left palette, then left click or drag over valid footprints to place it. Right mouse deletes player buildings.
- Hold Z for the ship menu, view ship stats/upgrades, and select the active primary weapon by clicking or using the mouse wheel.
- Hold Q for the quick-build palette. Conduit is first; mouse wheel or clicking a left-side palette icon selects what to place. With Conduit selected, left mouse queues player conduits with a 2x2 brush and right mouse erases with the same brush. With a building selected, left mouse places that building.
- For The Synonymous, Q replaces Conduit with Shape. Holding left mouse draws freeform swarm trails from the Command Post; right mouse recalls nearby free drones back toward the base. Buildings consume nanobots instead of money, and deleting a Synonymous building releases its nanobots back into the swarm.
- Hold X for research. Hold C for ship commands for groups 1, 2, 3, or ALL. Hold 1, 2, or 3 and click a shipyard to assign that number; hold a number and click elsewhere to set that group's waypoint; hold a number and right click to dock that group. Hold Tab for radar. F3 toggles the debug overlay. Escape pauses.

## Win And Loss

- Tutorial has no enemies and no win/loss.
- Practice and Vs. AI are won by destroying the enemy Command Post.
- Practice/Vs. AI defeat depends on setup, but the default is losing the player Command Post.
- The player ship can respawn after destruction if the match is not otherwise lost.

## Resources

- The player gains a small baseline income over time.
- Finished, powered Factories add bonus income.
- Buildings, conduits, and research spend resources only when the action succeeds. Conduits cost $1 per cell.
- The Synonymous player does not gain money income. Its visible free nanobot count is the spendable resource; Command Posts and Factories each produce 1 nanobot per second.

## Building Placement

- The grid cell size is one third of the original port grid.
- Buildings snap to grid footprints: most buildings are 3x3, Factories and Research Labs are 4x4, and Command Posts are 6x6.
- Placement requires enough resources, an empty cell, world bounds, and adjacency to the player power network.
- Concentroid placement instead requires the building footprint to sit on the race's frontier band.
- Synonymous placement is freeform and does not require grid power or frontier bands, but the player must have enough free nanobots for the selected structure.
- The player power network means a Command Post, Power Generator, powered conduit, existing conduit, or pending conduit next to the target cell.
- Command Post rebuild is hidden until the player has no Command Post.
- Invalid placement shows a red cursor and does not spend resources or fire weapons.

## Power

- This port intentionally uses conduit-graph power rather than pure radius power.
- Command Posts and completed Power Generators are power sources.
- Same-team conduits carry power by 4-way adjacency from a source.
- Non-source buildings are powered when their cell or a neighboring cell is energized.
- Powered conduits are brighter; pending conduits are dashed. Unpowered player buildings show a HUD warning.
- Shipyards, factories, labs, and turrets require construction completion and power for their active behavior.

## Fighters And Shipyards

- Fighter Yards produce fighters. Bomber Yards produce bombers after Bomber Yard research.
- Shipyards only produce while finished, powered, and below capacity.
- Advanced Fighters research raises player shipyard capacity and speeds player ship production.
- C-menu orders are active: Protect Base defends the player Command Post, Set Waypoint uses the cursor location, Follow Player follows the player ship, and Dock returns ships to their home yard.

## Enemy AI

- Enemy structures are queued by the base planner and then build visibly like player structures; in Vs. AI, the enemy main ship must be within 1000 world units of a queued structure before placement can start.
- Enemy fighter rally waypoints stay within 1000 world units of the enemy main ship when that ship exists.
- Higher difficulty enemies stage produced fighters near base before attacking. Nightmare timing waits for near-full shipyard output so ship production is not left capped and idle.
- Medium and higher enemies periodically audit power connectivity. Hard and Nightmare enemies prioritize reconnecting unpowered production, research, and turret areas before normal expansion, and add bounded redundant conduit links after repeated outages.
- Hard and Nightmare enemies avoid wasting Power Generators inside already-powered main rings, backfill safer inner rings with extra Fighter Yards, Bomber Yards, Research Labs, and Factories after outer defenses exist, and add protective wall patterns around key shipyards, labs, and turrets.

## Research

- Research requires at least one powered, finished Research Lab to progress.
- One active research item can run at a time.
- Active research items are turret unlocks, Bomber Yard, and Advanced Fighters.
- Completed research is hidden from the research menu and summarized on the HUD.

## Hidden Or Not Implemented

- Time Bomb, Signal Station, Jump Gate, Cloak, and Vs. Player are intentionally hidden from active menus because they do not have complete coherent gameplay.
- Constants or entity enum entries for hidden items may remain for compatibility, but they are not part of the playable contract.
