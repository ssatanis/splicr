// Development script to run Electron with Next.js dev server
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const NEXT_PORT = 3000;

// Check if a port is in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

// Wait for Next.js server to be ready
function waitForNext(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      isPortInUse(port).then((inUse) => {
        if (inUse) {
          console.log('✓ Next.js server is ready');
          resolve();
        } else if (Date.now() - start > timeout) {
          reject(new Error('Timeout waiting for Next.js server'));
        } else {
          setTimeout(check, 1000);
        }
      });
    };
    check();
  });
}

async function startDev() {
  try {
    // Check if Next.js is already running
    const nextRunning = await isPortInUse(NEXT_PORT);

    let nextProcess = null;
    if (!nextRunning) {
      console.log('Starting Next.js development server...');
      nextProcess = spawn('npm', ['run', 'dev'], {
        stdio: 'inherit',
        shell: true,
      });

      // Wait for Next.js to be ready
      await waitForNext(NEXT_PORT);
    } else {
      console.log('Next.js server is already running');
    }

    // Start Electron
    console.log('Starting Electron...');
    const electronBin = require('electron');
    const electronProcess = spawn(electronBin, [path.join(__dirname, 'main/background.js')], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });

    // Handle cleanup
    const cleanup = () => {
      electronProcess.kill();
      if (nextProcess) {
        nextProcess.kill();
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    electronProcess.on('close', cleanup);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

startDev();
