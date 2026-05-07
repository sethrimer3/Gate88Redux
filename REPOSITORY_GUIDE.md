# Repository Guide

## Purpose
This document maps the repository structure and gives a concise, broad summary of every tracked file.

## Agent Maintenance Instructions
- Any new file added to the repository **must** be added to this guide in the relevant section.
- Any substantive update to an existing file should add/update a short note here with the **approximate location** changed (for example: `src/game.ts` mid-file update loop, `docs/LAN.md` setup section).
- Keep entries concise: one-line file summary + one-line broad “contains” statement.
- When files are removed/renamed, update this guide in the same commit.

## Repository Structure
- `src/`: main game/client TypeScript code
- `server/`: LAN server/discovery TypeScript code
- `public/`: static assets served by Vite
- `ASSETS/`: source asset library (music, sound, fonts)
- `docs/`: project documentation
- `ORIGINAL/`: preserved original Gate88 distribution artifacts
- Root configs/docs: build tooling, specs, and project metadata

## Full File Inventory

| File | Short summary | Broad contents |
|---|---|---|
| `.github/copilot-instructions.md` | Markdown project documentation/spec. | Headings, prose guidance, constraints, and reference details for contributors/users. |
| `.github/workflows/static.yml` | Repository file. | File-specific data/content. |
| `.gitignore` | Repository file. | File-specific data/content. |
| `ASSETS/fonts/BJ_Cree/BJCree-Bold.ttf` | Source asset file (audio/font/license) used to populate public assets. | Binary font glyph and metrics data. |
| `ASSETS/fonts/BJ_Cree/BJCree-Medium.ttf` | Source asset file (audio/font/license) used to populate public assets. | Binary font glyph and metrics data. |
| `ASSETS/fonts/BJ_Cree/BJCree-Regular.ttf` | Source asset file (audio/font/license) used to populate public assets. | Binary font glyph and metrics data. |
| `ASSETS/fonts/BJ_Cree/BJCree-SemiBold.ttf` | Source asset file (audio/font/license) used to populate public assets. | Binary font glyph and metrics data. |
| `ASSETS/fonts/BJ_Cree/OFL.txt` | Source asset file (audio/font/license) used to populate public assets. | Human-readable text such as licenses/readme/guidelines. |
| `ASSETS/fonts/BJ_Cree_guidelines.txt` | Source asset file (audio/font/license) used to populate public assets. | Human-readable text such as licenses/readme/guidelines. |
| `ASSETS/fonts/Poiret_One/OFL.txt` | Source asset file (audio/font/license) used to populate public assets. | Human-readable text such as licenses/readme/guidelines. |
| `ASSETS/fonts/Poiret_One/PoiretOne-Regular.ttf` | Source asset file (audio/font/license) used to populate public assets. | Binary font glyph and metrics data. |
| `ASSETS/music/menu.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - disco past the floating clouds.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - jam session.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - late night driving music.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - old spark fizzes.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - overdub theory.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - rux9.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/music/queasy - somewhere east.ogg` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/bhit0.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/bigfire.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/bigmissile.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/bigregenbullet.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/build.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/changespecial.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/cloak.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/drive.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/enemydrive.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/enemyhere.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/exciterbeam.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/exciterbullet.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/explode0.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/explode1.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/explode2.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/fire.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/firebomb.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/genericcollision.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/heavy.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/laser.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/massdriverbullet.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/menucursor.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/menuselection.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/minilaser.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/missile.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/missile2.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/openradar.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/regenbullet.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/researchcomplete.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/selfregen.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `ASSETS/sound/shortbullet.wav` | Source asset file (audio/font/license) used to populate public assets. | Encoded audio waveform data; no source code. |
| `FEATURES.md` | Markdown project documentation/spec. | Headings, prose guidance, constraints, and reference details for contributors/users. |
| `GAMEPLAY_CONTRACT.md` | Markdown project documentation/spec. | Headings, prose guidance, constraints, and reference details for contributors/users. |
| `ORIGINAL/Gate88_Mar19_05/Colour Test.bat` | Original legacy Gate88 distribution/reference artifact. | Windows shell commands for launching utilities. |
| `ORIGINAL/Gate88_Mar19_05/Dedicated Server.bat` | Original legacy Gate88 distribution/reference artifact. | Windows shell commands for launching utilities. |
| `ORIGINAL/Gate88_Mar19_05/LGPL_license.txt` | Original legacy Gate88 distribution/reference artifact. | Human-readable text such as licenses/readme/guidelines. |
| `ORIGINAL/Gate88_Mar19_05/SDL.dll` | Original legacy Gate88 distribution/reference artifact. | Compiled binary artifact. |
| `ORIGINAL/Gate88_Mar19_05/SDL_mixer.dll` | Original legacy Gate88 distribution/reference artifact. | Compiled binary artifact. |
| `ORIGINAL/Gate88_Mar19_05/SDL_net.dll` | Original legacy Gate88 distribution/reference artifact. | Compiled binary artifact. |
| `ORIGINAL/Gate88_Mar19_05/audio.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/coloreditor.exe` | Original legacy Gate88 distribution/reference artifact. | Compiled binary artifact. |
| `ORIGINAL/Gate88_Mar19_05/colours.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/debug.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/gate88.exe` | Original legacy Gate88 distribution/reference artifact. | Compiled binary artifact. |
| `ORIGINAL/Gate88_Mar19_05/irc_client.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/irc_connection.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/license.txt` | Original legacy Gate88 distribution/reference artifact. | Human-readable text such as licenses/readme/guidelines. |
| `ORIGINAL/Gate88_Mar19_05/manual.html` | Original legacy Gate88 distribution/reference artifact. | HTML markup defining document structure/content. |
| `ORIGINAL/Gate88_Mar19_05/masterserver.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/multiplayer.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/practice.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/readme.txt` | Original legacy Gate88 distribution/reference artifact. | Human-readable text such as licenses/readme/guidelines. |
| `ORIGINAL/Gate88_Mar19_05/server.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/textcolours.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `ORIGINAL/Gate88_Mar19_05/video.conf` | Original legacy Gate88 distribution/reference artifact. | Key/value or section-based legacy runtime configuration parameters. |
| `docs/LAN.md` | Project documentation. | Headings, prose guidance, constraints, and reference details for contributors/users. |
| `docs/visual-polish.md` | Project documentation. | Headings, prose guidance, constraints, and reference details for contributors/users. |
| `index.html` | HTML entry or reference document. | HTML markup defining document structure/content. |
| `package-lock.json` | JSON configuration/metadata file. | Structured key/value settings consumed by npm, TypeScript, or tooling. |
| `package.json` | JSON configuration/metadata file. | Structured key/value settings consumed by npm, TypeScript, or tooling. |
| `public/favicon.svg` | Runtime-served static asset for web build. | XML vector path data for icon rendering. |
| `public/music/non-ingame/menu.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - disco past the floating clouds.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - jam session.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - late night driving music.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - old spark fizzes.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - overdub theory.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - rux9.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/music/queasy - somewhere east.ogg` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/bhit0.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/bigfire.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/bigmissile.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/bigregenbullet.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/build.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/changespecial.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/cloak.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/drive.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/enemydrive.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/enemyhere.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/exciterbeam.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/exciterbullet.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/explode0.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/explode1.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/explode2.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/fire.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/firebomb.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/genericcollision.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/heavy.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/laser.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/massdriverbullet.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/menucursor.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/menuselection.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/minilaser.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/missile.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/missile2.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/openradar.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/regenbullet.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/researchcomplete.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/selfregen.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `public/sound/shortbullet.wav` | Runtime-served static asset for web build. | Encoded audio waveform data; no source code. |
| `server/lanDiscovery.ts` | TypeScript LAN server module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `server/lanServer.ts` | TypeScript LAN server module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/actionmenu.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/aibaseplan.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/aidoctrine.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/airaids.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/aiscore.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/audio.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/builddefs.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/builderdrone.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/building.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/camera.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/colors.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/constants.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/decodeText.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/enemyai.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/enemybaseplanner.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/entities.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/fighter.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/fonts.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/game.ts` | Main client game coordinator. | Owns loop, mode transitions, input, spawning, LAN snapshots, and high-level render orchestration; heavyweight draw helpers live in `src/gameRender.ts`. |
| `src/gameRender.ts` | Extracted game render helpers. | Draws waypoint markers, debug overlay, and Concentroid territory visuals for `src/game.ts`. |
| `src/gamestate.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/glowlayer.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/grid.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/hud.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/input.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/lan/lanClient.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/lan/protocol.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/main.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/math.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/menu.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/mine.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/nebula.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/particles.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/power.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/practiceconfig.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/practicemode.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/projectile.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/radar.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/ringeffects.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/ship.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/spacefluid.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/special.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/starfield.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/teamutils.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/theme.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/turret.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/tutorial.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/version.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/visualquality.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/vsaibot.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `src/vsaiconfig.ts` | TypeScript gameplay/client module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
| `tsconfig.json` | JSON configuration/metadata file. | Structured key/value settings consumed by npm, TypeScript, or tooling. |
| `tsconfig.server.json` | JSON configuration/metadata file. | Structured key/value settings consumed by npm, TypeScript, or tooling. |
| `vite.config.ts` | TypeScript configuration or source module. | Exports constants/types/functions/classes implementing this subsystem; may include interfaces and update/render/control logic. |
