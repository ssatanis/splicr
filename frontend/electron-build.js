// Build script for Electron production build
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, 'app');
const apiDir = path.join(appDir, 'api');
const apiBackupDir = path.join(appDir, '_api_build_skip');
const authCallbackDir = path.join(appDir, 'auth', 'callback');
const authCallbackBackup = path.join(appDir, 'auth', '_callback_skip');
const authSignOutDir = path.join(appDir, 'auth', 'sign-out');
const authSignOutBackup = path.join(appDir, 'auth', '_signout_skip');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options,
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });

    proc.on('error', reject);
  });
}

function moveDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    return true;
  }
  return false;
}

async function build() {
  const moved = { api: false, authCallback: false, authSignOut: false };
  try {
    console.log('🔨 Building SplicR Desktop App...\n');

    // Step 0: Move server-only routes out so static export only has pages (desktop calls production API)
    if (moveDir(apiDir, apiBackupDir)) {
      console.log('Step 0: Temporarily moving app/api for static export...');
      moved.api = true;
    }
    if (moveDir(authCallbackDir, authCallbackBackup)) moved.authCallback = true;
    if (moveDir(authSignOutDir, authSignOutBackup)) moved.authSignOut = true;

    // Step 1: Build Next.js for static export
    console.log('Step 1: Building Next.js static export...');
    await runCommand('npm', ['run', 'build'], {
      env: {
        ...process.env,
        ELECTRON_BUILD: 'true',
        NEXT_PUBLIC_IS_ELECTRON: 'true',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://splicr.org',
      },
    });

    // Check if out directory was created
    if (!fs.existsSync('out')) {
      throw new Error('Next.js build did not create "out" directory');
    }

    console.log('✓ Next.js build complete\n');

    // Step 2: Build Electron with electron-builder
    console.log('Step 2: Building Electron distributables...');

    const builderArgs = ['electron-builder'];

    // Add platform-specific flags based on command line args
    const args = process.argv.slice(2);
    if (args.includes('--mac')) builderArgs.push('--mac');
    if (args.includes('--win')) builderArgs.push('--win');
    if (args.includes('--linux')) builderArgs.push('--linux');

    // If no platform specified, build for current platform only
    if (!args.some(arg => ['--mac', '--win', '--linux'].includes(arg))) {
      const platform = process.platform;
      if (platform === 'darwin') builderArgs.push('--mac');
      else if (platform === 'win32') builderArgs.push('--win');
      else builderArgs.push('--linux');
    }

    await runCommand('npx', builderArgs);

    console.log('\n✓ Build complete!');
    console.log('📦 Distributables are in the "dist" directory');

    // Fix macOS Gatekeeper issues automatically
    if (process.platform === 'darwin' && (args.includes('--mac') || !args.some(arg => ['--win', '--linux'].includes(arg)))) {
      console.log('\n🔧 Fixing macOS Gatekeeper issues...');
      try {
        // Find the built app
        let appPath = null;
        if (fs.existsSync('dist/mac/SplicR.app')) {
          appPath = 'dist/mac/SplicR.app';
        } else if (fs.existsSync('dist/mac-arm64/SplicR.app')) {
          appPath = 'dist/mac-arm64/SplicR.app';
        }

        if (appPath) {
          // Remove quarantine attribute
          await runCommand('xattr', ['-cr', appPath]);
          console.log('✓ Removed quarantine attribute');
          console.log('\n✅ App is ready to open!');
          console.log(`   You can now open: ${appPath}`);
        }
      } catch (error) {
        console.log('\n⚠️  Could not automatically fix Gatekeeper issues');
        console.log('   Please run: ./fix-mac-app.sh');
      }
    }

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  } finally {
    if (moved.api && fs.existsSync(apiBackupDir)) {
      // Remove existing api dir if it exists
      if (fs.existsSync(apiDir)) {
        fs.rmSync(apiDir, { recursive: true, force: true });
      }
      fs.renameSync(apiBackupDir, apiDir);
      console.log('Restored app/api');
    }
    if (moved.authCallback && fs.existsSync(authCallbackBackup)) {
      if (fs.existsSync(authCallbackDir)) {
        fs.rmSync(authCallbackDir, { recursive: true, force: true });
      }
      fs.renameSync(authCallbackBackup, authCallbackDir);
      console.log('Restored app/auth/callback');
    }
    if (moved.authSignOut && fs.existsSync(authSignOutBackup)) {
      if (fs.existsSync(authSignOutDir)) {
        fs.rmSync(authSignOutDir, { recursive: true, force: true });
      }
      fs.renameSync(authSignOutBackup, authSignOutDir);
      console.log('Restored app/auth/sign-out');
    }
  }
}

build();
