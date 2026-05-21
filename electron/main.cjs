const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DIST_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const USER_DATA_DIR = path.join(__dirname, '..', '.electron-user-data');
const OPEN_DEVTOOLS =
  process.argv.includes('--devtools') ||
  process.env.ELECTRON_DEBUG === '1' ||
  process.env.ELECTRON_DEBUG === 'true';
const DISABLE_GPU =
  process.env.GATE88_DISABLE_GPU === '1' ||
  process.env.GATE88_DISABLE_GPU === 'true';

app.setPath('userData', USER_DATA_DIR);

if (DISABLE_GPU) {
  app.disableHardwareAcceleration();
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
