// Electron main process
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

// Packaged app: always use production (serve from out/). Dev: use NODE_ENV.
const isProd = process.env.NODE_ENV === 'production' || app.isPackaged;

let mainWindow;
let loadURL;

function getOutDir() {
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    const base = path.dirname(appPath);
    return path.join(base, 'app.asar.unpacked', 'out');
  }
  return path.join(__dirname, '..', 'out');
}

function createWindow() {
  const winOpts = {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
    frame: true,
  };
  // macOS-only options (avoid on other platforms to prevent native crashes)
  if (process.platform === 'darwin') {
    winOpts.titleBarStyle = 'hiddenInset';
    winOpts.trafficLightPosition = { x: 16, y: 16 };
    try {
      winOpts.vibrancy = 'sidebar';
      winOpts.visualEffectState = 'active';
      winOpts.roundedCorners = true;
    } catch (_) {}
  }

  mainWindow = new BrowserWindow(winOpts);

  if (isProd && typeof loadURL === 'function') {
    loadURL(mainWindow);
  } else if (!isProd) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(getOutDir(), 'index.html'));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// electron-serve is ESM: must use dynamic import. Call serve() before app ready.
(async () => {
  if (isProd) {
    try {
      const { default: serve } = await import('electron-serve');
      loadURL = serve({ directory: getOutDir() });
    } catch (err) {
      console.error('electron-serve failed:', err);
      process.exit(1);
    }
  }
  await app.whenReady();
  createWindow();
})();

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Set app name
app.setName('SplicR');
