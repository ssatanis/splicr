# SplicR Electron Desktop App Setup

## Current Status

The Electron desktop app infrastructure has been set up with the following components:

### Configuration Files Created:
- `main/background.js` - Electron main process entry point
- `electron-build.js` - Build script for creating distributables
- `build/entitlements.mac.plist` - macOS code signing entitlements
- Updated `package.json` with Electron scripts and electron-builder configuration
- Updated `next.config.js` for conditional static export

### Build Process

To build desktop distributables:

```bash
# Build for all platforms
npm run build:electron

# Build for specific platforms
npm run build:electron:mac
npm run build:electron:win
npm run build:electron:linux
```

This will:
1. Build Next.js as a static export (in `out/` directory)
2. Package with Electron
3. Create distributable files in `dist/`:
   - `SplicR-1.0.0.dmg` (Mac)
   - `SplicR Setup 1.0.0.exe` (Windows)
   - `SplicR-1.0.0.AppImage` (Linux)

### Development Mode

From the **repo root** or from **frontend**:

```bash
# From root (starts Next dev server + Electron window)
npm run dev:electron

# Or from frontend
cd frontend && npm run dev:electron
```

The desktop app in dev loads `http://localhost:3000`; the desktop build uses a static export and calls the production API at `https://splicr.org/api`.

### Building from Repo Root

You can run all commands from the project root; they delegate to the frontend:

```bash
npm run build:electron        # Mac, Windows, Linux
npm run build:electron:mac    # Mac only
npm run dev:electron          # Dev mode (Next + Electron)
```

### Security & Distribution

The app is configured with:
- Code signing entitlements (macOS)
- Sandboxing enabled
- Context isolation
- No unsafe eval or remote module access

This ensures the app won't be flagged as malware by modern operating systems.

### Styling

The Electron window is configured with:
- Rounded corners (macOS)
- Native title bar style (`hiddenInset`)
- Vibrancy effects (macOS sidebar style)
- Same fonts and styling as web version (inherited from Next.js build)

All visual elements from the web version are preserved in the desktop app.
