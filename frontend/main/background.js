// Electron main process - no ESM deps so packaged app launches reliably
'use strict';

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const isProd = process.env.NODE_ENV === 'production' || app.isPackaged;

// Setup logging to file for debugging
const logFile = path.join(app.getPath('userData'), 'electron-debug.log');
const log = (...args) => {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (e) {
    // Ignore write errors
  }
};

log('=== SplicR Starting ===');
log('isProd:', isProd);
log('app.isPackaged:', app.isPackaged);
log('process.platform:', process.platform);

let mainWindow;

// Disable hardware acceleration on macOS to prevent GPU crashes
if (process.platform === 'darwin') {
  app.disableHardwareAcceleration();
}

// Add command-line switches to fix macOS compatibility issues
app.commandLine.appendSwitch('disable-features', 'MediaRouter');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
app.commandLine.appendSwitch('disable-renderer-backgrounding', 'true');

// Handle crashes gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Don't exit immediately - let the app try to recover
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

function getOutDir() {
  if (app.isPackaged) {
    // When ASAR is disabled, files are in app.getAppPath()
    // When ASAR is enabled, files are in app.asar.unpacked
    const appPath = app.getAppPath();
    
    // Check if we're using ASAR
    if (appPath.includes('.asar')) {
      const base = path.dirname(appPath);
      return path.join(base, 'app.asar.unpacked', 'out');
    } else {
      // ASAR disabled - files are directly in the app path
      return path.join(appPath, 'out');
    }
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
      // Disable features that can cause crashes on macOS
      enablePreferredSizeMode: false,
      spellcheck: false,
    },
    frame: true,
  };
  if (process.platform === 'darwin') {
    winOpts.titleBarStyle = 'hiddenInset';
    winOpts.trafficLightPosition = { x: 16, y: 16 };
    // Disable vibrancy effects that can cause issues on macOS 26
    // try {
    //   winOpts.vibrancy = 'sidebar';
    //   winOpts.visualEffectState = 'active';
    //   winOpts.roundedCorners = true;
    // } catch (_) {}
  }

  mainWindow = new BrowserWindow(winOpts);
  
  // Add error handlers to prevent crashes
  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('WebContents crashed:', { killed });
    // Reload the page on crash
    if (!killed) {
      mainWindow.reload();
    }
  });
  
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Render process gone:', details);
    if (details.reason !== 'clean-exit') {
      mainWindow.reload();
    }
  });
  
  // Log console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}]:`, message);
  });
  
  // Log any loading failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', { errorCode, errorDescription, validatedURL });
  });

  if (isProd) {
    const outDir = getOutDir();
    log('Loading from outDir:', outDir);
    log('outDir exists:', fs.existsSync(outDir));
    if (fs.existsSync(outDir)) {
      const contents = fs.readdirSync(outDir).slice(0, 10);
      log('outDir contents:', contents);
      const indexPath = path.join(outDir, 'index.html');
      log('index.html exists:', fs.existsSync(indexPath));
    }
    log('Loading URL: app://-/');
    mainWindow.loadURL('app://-/');
    // Open DevTools in production for debugging
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  }
  
  log('Window created and loading started');

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
  // Disable network state watcher to prevent macOS crashes
  app.setLoginItemSettings({
    openAtLogin: false,
    openAsHidden: false
  });
  
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
}).catch((error) => {
  console.error('Failed to initialize app:', error);
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.setName('SplicR');
