# Visual Polish Notes

Implemented:
- `src/glowlayer.ts` adds a low-resolution additive glow pass for major effects without WebGL, `getImageData`, or full-screen blur.
- `src/visualquality.ts` defines `low`, `medium`, and `high` presets. Press `F6` while playing to cycle quality at runtime.
- Lasers and charged laser bursts now use layered beams, white cores, endpoint rings, and animated energy crawl.
- Guided, bomber, and swarm missiles feed selective exhaust into the low-resolution glow layer.
- Player shield, boost/overdrive, and overheat states get selective aura glow.
- Ring effects now support shockwave, EMP, build-complete, power-restore, and blackout-style variants with culling and active-count caps.
- Conduit shimmer can be toggled by quality; powered conduits keep deterministic coordinate-based phase offsets.
- The screen overlay now uses a cached vignette gradient plus a subtle territory tint and optional high-quality scanlines.
- **Crystal Nebula Clouds** (`src/crystalnebula.ts`): tiny angular crystal motes (diamonds, rhombuses, 4-point glints) scattered across 9 world regions in a parallax-aware layer between the starfield and gameplay. Ships, fighters, bullets, missiles, and explosions disturb the motes; spring-damping physics returns them to their home positions. Quality-scaled: disabled on Low, sparse on Medium, full density with glow on High.

Tuning:
- Change the default in `src/visualquality.ts` via `DEFAULT_VISUAL_QUALITY`.
- Adjust glow cost through each preset's `glowEnabled` and `glowScale`.
- `low` disables glow and conduit shimmer, lowers ring capacity, keeps fluid in low graphics mode, and disables crystal nebula entirely.
- `medium` is the safe default: glow at 0.25 scale, conduit shimmer on, fluid low graphics, crystal nebula at 40 % density with no per-mote glow.
- `high` raises glow to 0.33 scale, enables scanlines and full fluid density, crystal nebula at 100 % density with glow highlights for disturbed motes and glints.

Crystal Nebula tuning knobs (in `src/visualquality.ts` presets):
- `crystalNebulaEnabled` — master on/off flag.
- `crystalNebulaDensityScale` — fraction of base particle count to spawn (0–1).
- `crystalNebulaGlow` — route brightest glints and disturbed motes into the GlowLayer.
- `crystalNebulaInteractionScale` — multiplier for how strongly entities push motes (0–1).

Crystal Nebula physics constants (in `src/crystalnebula.ts`):
- `SPRING_K` — spring-back rate toward home position.
- `DAMPING` — per-frame velocity damping (base for `pow(d, dt*60)`).
- `ANGULAR_DAMPING` — per-frame rotation damping.
- `ACTIVITY_DECAY` — rate (1/s) at which the "activity" boost decays.
- Disturbance radii and strengths are in `injectCrystalDisturbances()` in `src/fluidForces.ts`.

Performance choices:
- Glow is drawn into a small offscreen canvas and upscaled additively.
- Major effects are drawn into glow; normal particles are not duplicated there.
- Ring effects use stroked circles/arcs only and are culled when off-screen.
- Conduit shimmer is simple rectangle/stripe drawing for visible sparse conduit cells only.
- Screen overlays are one cached gradient fill, one tint fill, and an optional tiny repeating pattern.
- Crystal Nebula: particles are pre-allocated at quality-configure time using a seeded PRNG for stable layout. Disturbances are a fixed-size list (max 32) cleared each tick. A cloud-level bounding-circle test skips entire clouds before per-particle work. Viewport margin culling skips off-screen motes during draw. No getImageData, no blur, no per-frame allocation.

Future work:
- Add dedicated afterimage ribbons to AI player ships and elite fighters if profiling shows headroom.
- Route building-specific power restore and blackout events to the newer ring variants more granularly.
- Add a settings menu control for visual quality; runtime `F6` exists for quick comparison.
- Add pooled smoke puffs and stronger shield-hit flashes as optional polish after a browser profiling pass.
- Wire laser-kill explosion events into `crystalNebula.addExplosion()` via `combatUtils.ts` / `weaponFiring.ts` (see `nextSteps.md`).

