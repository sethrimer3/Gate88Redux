# Visual Polish Notes

Implemented:
- `src/glowlayer.ts` adds a low-resolution additive glow pass for major effects without WebGL, `getImageData`, or full-resolution blur.
- `src/visualquality.ts` defines `low`, `medium`, and `high` presets. Press `F6` while playing to cycle quality at runtime.
- Lasers and charged laser bursts now use layered beams, white cores, endpoint rings, and animated energy crawl.
- Guided, bomber, and swarm missiles feed selective exhaust into the low-resolution glow layer.
- Player shield, boost/overdrive, and overheat states get selective aura glow.
- Ring effects now support shockwave, EMP, build-complete, power-restore, and blackout-style variants with culling and active-count caps.
- Conduit shimmer can be toggled by quality; powered conduits keep deterministic coordinate-based phase offsets.
- The screen overlay now uses a cached vignette gradient plus a subtle territory tint and optional high-quality scanlines.

Tuning:
- Change the default in `src/visualquality.ts` via `DEFAULT_VISUAL_QUALITY`.
- Adjust glow cost through each preset's `glowEnabled` and `glowScale`.
- `low` disables glow and conduit shimmer, lowers ring capacity, and keeps fluid in low graphics mode.
- `medium` is the safe default: glow at 0.25 scale, conduit shimmer on, fluid low graphics.
- `high` raises glow to 0.33 scale, enables scanlines, and restores high fluid density.

Performance choices:
- Glow is drawn into a small offscreen canvas and upscaled additively.
- Major effects are drawn into glow; normal particles are not duplicated there.
- Ring effects use stroked circles/arcs only and are culled when off-screen.
- Conduit shimmer is simple rectangle/stripe drawing for visible sparse conduit cells only.
- Screen overlays are one cached gradient fill, one tint fill, and an optional tiny repeating pattern.

Future work:
- Add dedicated afterimage ribbons to AI player ships and elite fighters if profiling shows headroom.
- Route building-specific power restore and blackout events to the newer ring variants more granularly.
- Add a settings menu control for visual quality; runtime `F6` exists for quick comparison.
- Add pooled smoke puffs and stronger shield-hit flashes as optional polish after a browser profiling pass.
