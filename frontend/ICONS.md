# SplicR Desktop App Icons

## Icon Files

All platform-specific icons have been created from the SplicR favicon (`faviconslicr.png`):

### macOS
- **File**: `build-resources/icon.icns`
- **Size**: 214 KB
- **Contains**: Multiple resolutions (16x16 to 1024x1024 @2x)
- **Features**: Retina-ready with @2x versions

### Windows
- **File**: `build-resources/icon-256.png`
- **Size**: 15 KB
- **Resolution**: 256x256 pixels
- **Note**: Electron-builder automatically converts to .ico format during build

### Linux
- **File**: `build-resources/icon-512.png`
- **Size**: 41 KB
- **Resolution**: 512x512 pixels
- **Formats**: Used for AppImage, .deb, and .rpm packages

### Source Icon
- **File**: `build-resources/icon.png`
- **Size**: 39 KB
- **Resolution**: 500x500 pixels (original favicon)

## Web Version
The same icon is also available for the web version:
- `public/favicon.png` (39 KB, 500x500)
- `public/faviconslicr.png` (original)

## Icon Quality
All icons maintain the original SplicR branding:
- ✅ High-resolution source (500x500)
- ✅ Retina-ready for macOS
- ✅ Optimized sizes for each platform
- ✅ Consistent branding across all platforms

## Build Configuration
Icons are referenced in `package.json` under the `build` section:
```json
{
  "mac": { "icon": "build-resources/icon.icns" },
  "win": { "icon": "build-resources/icon-256.png" },
  "linux": { "icon": "build-resources/icon-512.png" }
}
```

## Icon Display

### macOS
- App icon in Dock
- App icon in Launchpad
- App icon in Finder
- Window title bar icon
- DMG installer background

### Windows
- Desktop shortcut icon
- Start Menu icon
- Taskbar icon
- Window title bar icon
- Installer icon

### Linux
- Application menu icon
- Window manager icon
- Desktop file icon
- Panel/taskbar icon

## Rebuilding Icons

If you need to regenerate icons from a new source image:

```bash
cd frontend

# Ensure you have the source image
# cp /path/to/new-icon.png build-resources/icon.png

# Create macOS .icns
mkdir -p build-resources/icon.iconset
sips -z 16 16 build-resources/icon.png --out build-resources/icon.iconset/icon_16x16.png
sips -z 32 32 build-resources/icon.png --out build-resources/icon.iconset/icon_16x16@2x.png
sips -z 32 32 build-resources/icon.png --out build-resources/icon.iconset/icon_32x32.png
sips -z 64 64 build-resources/icon.png --out build-resources/icon.iconset/icon_32x32@2x.png
sips -z 128 128 build-resources/icon.png --out build-resources/icon.iconset/icon_128x128.png
sips -z 256 256 build-resources/icon.png --out build-resources/icon.iconset/icon_128x128@2x.png
sips -z 256 256 build-resources/icon.png --out build-resources/icon.iconset/icon_256x256.png
sips -z 512 512 build-resources/icon.png --out build-resources/icon.iconset/icon_256x256@2x.png
sips -z 512 512 build-resources/icon.png --out build-resources/icon.iconset/icon_512x512.png
sips -z 1024 1024 build-resources/icon.png --out build-resources/icon.iconset/icon_512x512@2x.png
iconutil -c icns build-resources/icon.iconset -o build-resources/icon.icns

# Create Windows and Linux icons
sips -z 256 256 build-resources/icon.png --out build-resources/icon-256.png
sips -z 512 512 build-resources/icon.png --out build-resources/icon-512.png
```

All icons will be automatically included in the next build.
