# Running Gate88Redux in Electron

This repo remains a Vite browser game first. The Electron setup is a local desktop shell around the built `dist` output; it does not replace the browser dev server or GitHub Pages build.

## Commands

Install dependencies:

```powershell
npm install
```

Run the normal browser dev server:

```powershell
npm run dev
```

Build the game and launch it in Electron:

```powershell
npm run desktop
```

Launch with Electron devtools open:

```powershell
npm run electron:debug
```

## How It Loads

`electron/main.cjs` creates a locked-down `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and no preload script. It loads `dist/index.html` from disk, so `npm run desktop` runs the production build before starting Electron.

Vite is configured with `base: './'`, which keeps built script, CSS, image, audio, and font references relative to `dist/index.html`. That shape works for local `file://` Electron loading and is also safe for GitHub Pages project-path hosting.

## Electron Content Security Policy

The shared browser `index.html` intentionally does not include a CSP meta tag. GitHub Pages keeps using the normal Vite output without Electron-specific headers or routing changes.

Electron installs its CSP in `electron/main.cjs` with `session.defaultSession.webRequest.onHeadersReceived`. The production policy is used when Electron loads the built `dist/index.html` and does not include `'unsafe-eval'`. A separate development policy is available when launching Electron against a Vite server with `GATE88_ELECTRON_DEV_URL`; that policy allows localhost, websocket connections, and `'unsafe-eval'` for dev tooling.

## Troubleshooting

Black screen:

- Run `npm run electron:debug` and check the Console tab.
- Confirm `dist/index.html` exists. If it does not, run `npm run build`.

Missing assets, audio, or fonts:

- Search the console for `ERR_FILE_NOT_FOUND`.
- Check whether a failed URL starts with `/assets`, `/sound`, `/music`, or `/ASSETS`. Built Electron files should load relative paths from `dist`, not site-root absolute paths.

Build errors:

- Run `npm run typecheck` for TypeScript-only failures.
- Run `npm run build` before `npm run desktop`; the desktop command cannot run without a valid production build.
