// Electron main process - no ESM deps so packaged app launches reliably
'use strict';

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const isProd = process.env.NODE_ENV === 'production' || app.isPackaged;

let mainWindow;

function getOutDir() {
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    const base = path.dirname(appPath);
    return path.join(base, 'app.asar.unpacked', 'out');
  }
  return path.join(__dirname, '..', 'out');
}

// Register app:// scheme before app.ready (required by Electron)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

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

  if (isProd) {
    mainWindow.loadURL('app://-/');
  } else {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  }

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

app.whenReady().then(() => {
  if (isProd) {
    const outDir = getOutDir();
    const indexHtml = path.join(outDir, 'index.html');
    protocol.handle('app', (request) => {
      let urlPath = request.url.slice('app://-'.length).replace(/^\/+/, '') || '';
      let resolved = indexHtml;
      if (urlPath && urlPath !== '/') {
        const segments = urlPath.split('/').filter(Boolean);
        const noExt = path.join(outDir, ...segments);
        const withHtml = noExt + '.html';
        const withIndex = path.join(noExt, 'index.html');
        try {
          if (fs.statSync(withHtml).isFile()) resolved = withHtml;
          else if (fs.statSync(noExt).isDirectory() && fs.statSync(withIndex).isFile()) resolved = withIndex;
          else if (fs.statSync(noExt).isFile()) resolved = noExt;
        } catch (_) {
          try {
            if (fs.statSync(withIndex).isFile()) resolved = withIndex;
          } catch (_) {}
        }
      }
      return net.fetch(pathToFileURL(resolved).href);
    });
  }
  createWindow();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.setName('SplicR');
