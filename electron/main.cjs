const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');

const REPO_ROOT = path.join(__dirname, '..');
const DIST_INDEX = path.join(REPO_ROOT, 'dist', 'index.html');
const USER_DATA_DIR = path.join(REPO_ROOT, '.electron-user-data');
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const LAN_SERVER_ENTRY = path.join(REPO_ROOT, 'server', 'lanServer.ts');
const LAN_PORT = parseInt(process.env.LAN_PORT ?? '8787', 10);
const LAN_DISCOVERY_HTTP_PORT = parseInt(process.env.LAN_DISCOVERY_HTTP_PORT ?? '8788', 10);
const SHOULD_AUTO_START_LAN_HELPER =
  process.env.GATE88_AUTO_START_LAN_HELPER !== '0' &&
  process.env.GATE88_AUTO_START_LAN_HELPER !== 'false';
const OPEN_DEVTOOLS =
  process.argv.includes('--devtools') ||
  process.env.ELECTRON_DEBUG === '1' ||
  process.env.ELECTRON_DEBUG === 'true';
const DISABLE_GPU =
  process.env.GATE88_DISABLE_GPU === '1' ||
  process.env.GATE88_DISABLE_GPU === 'true';

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let lanHelperProcess = null;
let lanHelperStarting = false;

app.setPath('userData', USER_DATA_DIR);

if (DISABLE_GPU) {
  app.disableHardwareAcceleration();
}

function probeTcpPort(port, host = '127.0.0.1', timeoutMs = 350) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function probeLanHelperHttp(timeoutMs = 500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: LAN_DISCOVERY_HTTP_PORT,
        path: '/lan/self',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.once('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.once('error', () => resolve(false));
  });
}

function resolveTsxCommand() {
  const isWindows = process.platform === 'win32';
  const localTsx = path.join(REPO_ROOT, 'node_modules', '.bin', isWindows ? 'tsx.cmd' : 'tsx');
  if (fs.existsSync(localTsx)) {
    return { command: localTsx, args: [LAN_SERVER_ENTRY], shell: false };
  }
  return {
    command: isWindows ? 'npm.cmd' : 'npm',
    args: ['run', 'lan:server'],
    shell: false,
  };
}

async function ensureLanHelperRunning() {
  if (!SHOULD_AUTO_START_LAN_HELPER) {
    console.log('[Gate88 Electron] LAN helper auto-start disabled by GATE88_AUTO_START_LAN_HELPER.');
    return false;
  }
  if (lanHelperProcess && !lanHelperProcess.killed) return true;
  if (lanHelperStarting) return false;

  lanHelperStarting = true;
  try {
    if (await probeLanHelperHttp()) {
      console.log('[Gate88 Electron] Existing LAN helper detected on localhost.');
      return true;
    }

    const portInUse = await probeTcpPort(LAN_PORT);
    if (portInUse) {
      console.warn(`[Gate88 Electron] LAN port ${LAN_PORT} is already in use, but the discovery helper on ${LAN_DISCOVERY_HTTP_PORT} did not answer. Not starting another helper.`);
      return false;
    }

    if (!fs.existsSync(LAN_SERVER_ENTRY)) {
      console.warn(`[Gate88 Electron] LAN helper entry not found: ${LAN_SERVER_ENTRY}`);
      return false;
    }

    const { command, args, shell } = resolveTsxCommand();
    console.log(`[Gate88 Electron] Starting LAN helper: ${command} ${args.join(' ')}`);

    lanHelperProcess = spawn(command, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        GATE88_ELECTRON_LAN_HELPER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell,
    });

    lanHelperProcess.stdout.on('data', (data) => {
      process.stdout.write(`[Gate88 LAN helper] ${data}`);
    });
    lanHelperProcess.stderr.on('data', (data) => {
      process.stderr.write(`[Gate88 LAN helper] ${data}`);
    });
    lanHelperProcess.once('exit', (code, signal) => {
      console.log(`[Gate88 Electron] LAN helper exited with code=${code ?? 'null'} signal=${signal ?? 'null'}.`);
      lanHelperProcess = null;
    });
    lanHelperProcess.once('error', (err) => {
      console.error('[Gate88 Electron] Failed to start LAN helper:', err);
      lanHelperProcess = null;
    });

    return true;
  } finally {
    lanHelperStarting = false;
  }
}

function stopLanHelper() {
  if (!lanHelperProcess || lanHelperProcess.killed) return;
  console.log('[Gate88 Electron] Stopping LAN helper.');
  lanHelperProcess.kill('SIGINT');
  setTimeout(() => {
    if (lanHelperProcess && !lanHelperProcess.killed) {
      lanHelperProcess.kill();
    }
  }, 1500).unref();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(fs.existsSync(PRELOAD_PATH) ? { preload: PRELOAD_PATH } : {}),
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (OPEN_DEVTOOLS) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (!fs.existsSync(DIST_INDEX)) {
    throw new Error(`Missing built game entry: ${DIST_INDEX}. Run npm run build first.`);
  }

  void win.loadFile(DIST_INDEX);
}

app.whenReady().then(() => {
  void ensureLanHelperRunning();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopLanHelper();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
